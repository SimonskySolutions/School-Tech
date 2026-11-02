# 0037 Restore drills and recovery: a monthly drill, and a runbook proven in CI

Date: 2026-11-02 · Status: Accepted

## Context

ADR 0033 set the recovery targets: at most **5 minutes of data lost** and **4 hours to restore service**. ADR 0035 built continuous, encrypted, off-site backups. A backup is only known to work once it has been restored. GDPR Art. 32(1)(d) asks for a process of "regularly testing, assessing and evaluating" the measures that keep personal data available.

Two different things must be proven:
- **that the backups restore**, regularly, without disturbing the running platform;
- **that a lost server can be rebuilt** from what is kept off the host: the off-site storage, the secrets and the settings. The documents come first and then the database, as ADR 0029 asks.

The hosting is not chosen yet, so there is no second server to drill on. Whatever is built must also work on one.

Options considered:

| Option | Verdict |
| --- | --- |
| Restore into a second database of the running cluster | Shares the live server's processes and settings: does not prove a cluster can be rebuilt, and pgBackRest restores whole clusters |
| Restore on a second host each month | The real thing, but no second host exists yet; also a cost |
| **A scratch volume on the same host, a PostgreSQL started inside the drill's container** | **Chosen**: a whole cluster rebuilt from the off-site storage alone, with no network and no access to the live data directory; runs anywhere the image runs, so it also works on a second host later |
| Logical comparison (`pg_dump` of both) | Slow and heavy for every table; row counts at an exact moment, plus amcheck, prove as much |

## Decision

**The drill: `docker compose run --rm restore-drill`**, from the PostgreSQL image (the same pgBackRest as the backups), monthly through a systemd timer (`infra/systemd/`).

The drill's container sees three things:
- the off-site storage;
- a scratch volume (`drill_data`);
- the live database's local socket, used only to mark the moment it restores.

It never sees the live data directory. The steps:

1. **It marks a moment.** It creates a named restore point in the live database (`pg_create_restore_point`). In the same snapshot it counts the rows of every table of the platform's database.
2. **It waits until that moment is off the host.** It switches the write-ahead log and waits for the segment to arrive. The time this takes is the data that losing the server would cost; it must stay under 5 minutes.
3. **It restores** the cluster from the off-site storage into the scratch volume, to exactly that moment. It then replays the log in a PostgreSQL started inside the container, with no network and with archiving off, so the drill can never write to the repository.
4. **It checks:**
   - `pg_amcheck` (every table and index, all three databases);
   - every table of every database counted;
   - the same tables as the live databases;
   - in the platform's database, **every table holding exactly the rows it held at the marked moment**.
5. **It checks the documents.** Every document version the restored database refers to must be in the off-site copy as of that moment, except versions uploaded since the last copy, which are counted separately. Twenty versions, chosen at random, are read back and compared with the checksum the database holds.
6. **It measures the time.** The whole drill must take under 4 hours. It writes a report: table names and row counts only, no personal data. It records the time of its success and its duration, which monitoring reads; `RestoreCheckOverdue` fires 35 days after the last success. It then empties the scratch volume.

`--time=<T>` restores to a chosen time instead, and `--name=<N>` to an earlier named point. On a host without the live database, the drill restores to the latest moment the archive holds.

**The lost server's runbook** (docs/operations.md) needs only what ADR 0033 keeps off the host:
- the off-site storage;
- a copy of the secrets directory and `.env`;
- the images.

The steps:

1. Start the object store and set it up (`storage-init`).
2. `run --rm restore documents [T]` puts the documents back. It copies the current copy plus whatever was moved aside after T, using the API's key, the only key that may write the bucket.
3. `run --rm restore database [T]` restores the cluster into the database's own, empty volume. It replays the log in its own container, then archives the new timeline itself, so the backups continue from the restored database.
4. `up -d --wait` starts everything else. The backup service sees the restore and takes a full backup first.

`scripts/prod-stack-test.sh` runs both in CI on every push:
- drills to a marked moment and to a chosen time;
- deletes every container and volume of the stack, then follows the runbook.

It then checks that a change made just before the loss survived, that the documents came back with their contents, that the identity provider kept its realm, and that a full backup of the new timeline was taken.

**Erasures.** A restore to an earlier moment brings back the data of erasures completed after it. The runbook re-applies them before the platform is opened. The list comes from the live database when it still exists, otherwise from the data protection officer's record of requests, with `privacy.pseudonymise_person` or the portal's own erasure.

## Consequences

- The drill needs free disk space about the size of the database, for a few minutes each month. The scratch volume is emptied after a successful drill, and left after a failed one for inspection.
- The drill reads the whole repository's newest backup over the network each month. That is part of the off-site storage's cost.
- The secrets directory and `.env` must be kept off the host as well (an encrypted copy in the group's password manager), not only the three backup passphrases. Without the original secrets, the database's role passwords and Keycloak's client secrets no longer match. They can be reset (the runbook says how), but that takes longer.
- The drill and the runbook run on the same host until a second one exists. Once the hosting is chosen, the same commands drill on a second host. That host needs only the image, the backup secrets and access to the storage.
- M8.8 runs the whole platform end to end in CI, a restore drill included.
