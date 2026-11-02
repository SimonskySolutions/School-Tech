# 0036 Monitoring and alerts: Prometheus on the host, alerts by e-mail

Date: 2026-11-02 · Status: Accepted

## Context

The production stack (ADR 0033) runs on one host. Its recovery targets (5 minutes of data lost, 4 hours to restore) only hold if someone learns quickly that something is wrong. That covers a service that stopped, a disk filling up, the write-ahead log not reaching the off-site storage, or the newest backup getting old. Several obligations also have deadlines that nobody watches by hand:
- data subject requests must be answered within a month (GDPR Art. 12(3));
- the audit log needs next month's partition before the month begins;
- e-mails and provider webhooks must not pile up unseen.

The brief names Prometheus and Alertmanager. The hosting provider is not chosen yet, so nothing may depend on a provider's monitoring. Measures must carry no personal data, because they are kept outside the database, its row-level security and its retention rules.

Options checked on 2026-11-02:

| Option | Verdict |
| --- | --- |
| A provider's monitoring | Not chosen yet; would tie the platform to it |
| A hosted service (Grafana Cloud, Datadog) | Sends the host's and the platform's measures to a third party outside the group's control; a cost |
| **Prometheus v3.13.5, Alertmanager v0.34.1 and the official exporters** on the host | **Chosen**: what the brief names; everything stays on the host; rules testable with `promtool` |
| Grafana for dashboards | Deferred: alerts matter first, and the Prometheus interface answers ad-hoc questions; it can be added on top later without changing anything here |

## Decision

**One monitoring image, many services.** `infra/images/monitoring.Dockerfile` starts from the official Prometheus image. It copies in the official binaries of Alertmanager and four exporters, each pinned by version and digest:
- node_exporter v1.12.1;
- blackbox_exporter v0.29.1;
- postgres_exporter v0.20.1 and pgbouncer_exporter v0.12.1;
- redis_exporter v1.94.0.

`compose.production.yaml` runs each one as its own service from that image. Each runs as `nobody`, read-only, with no capabilities. `infra/monitoring/run.sh` writes each service's settings into its configuration when it starts. Nothing is published: an administrator reaches Prometheus and Alertmanager through `docker compose exec`.

**What is measured.**

- **The host.** node_exporter covers disks, memory and processors, reading the host's root filesystem read-only.
- **PostgreSQL.** postgres_exporter covers connections, the archiver and long transactions. It connects as `pyth_monitor`, a role with only `pg_monitor`, read-only, limited to 3 connections, and always over verified TLS.
- **PgBouncer.** pgbouncer_exporter reads PgBouncer's `SHOW` commands as `pyth_monitor`, which PgBouncer lists in `stats_users`.
- **Redis.** redis_exporter connects as a Redis user `pyth_monitor` that may only run `INFO`, `PING`, `CONFIG GET` and a few read-only commands, and may read no keys.
- **Garage, Keycloak and Alertmanager.** Their own metrics endpoints; Garage's needs a token of its own.
- **The applications.** blackbox_exporter calls each application's health check and checks the gateway's certificate: whether it is valid and how long it has left.
- **The platform itself.** The worker serves `/metrics` on port 9464, on the data network only. Its figures come from `monitoring.platform_metrics()`, a database function the worker alone may call. The function returns counts only:
  - events waiting in the outbox, and the age of the oldest;
  - events retrying, and provider webhooks waiting or failed;
  - e-mails overdue, and those given up on in the last day;
  - data subject requests open, due within 7 days, and overdue;
  - audit partitions ahead, and rows in the default partition.

  The worker adds BullMQ's job counts per queue and state, and its own process measures.
- **The backups.** After each run the backup service writes when the newest full and differential backups finished, whether the last one failed, and when the documents were last copied. It also writes when a restore drill last succeeded (M8.7). These go into a file on the `backup_state` volume, which node_exporter reads.

No measure names a person, school or child. Labels are job, queue, state and service names. Prometheus keeps 30 days (`MONITOR_RETENTION`).

**Alerts.** 36 rules are in `infra/monitoring/rules/`, each with a severity and a description of what to do. They cover:
- **Infrastructure:** a target or health check down, the certificate, disks, memory, processors.
- **PostgreSQL and PgBouncer:** down, connections, failed archiving, long transactions, clients waiting.
- **Redis:** down, memory.
- **Monitoring itself:** alerts not being delivered, rules failing to evaluate.
- **The platform:** the outbox, queues, webhooks, e-mails, data subject requests due and overdue, audit partitions.
- **The backups:** age, failure, the documents' copy, the backup service reporting nothing, the restore drill.

While PostgreSQL or Redis is down, Alertmanager holds back the alerts that only follow from it.

**Alerts by e-mail.** Alertmanager sends through the platform's own SMTP service (ADR 0031), STARTTLS required, to `ALERT_EMAIL_TO`. Critical alerts repeat every 4 hours while they last, warnings daily, and each is followed by a message when it resolves. Of the monitoring services, only Alertmanager reaches the `egress` network. The others have no way out:
- Prometheus sits on a new internal `monitoring` network, and on the internal data network to reach the exporters and the worker;
- node_exporter sits on the `monitoring` network only.

**Each alert tested by firing it.** `infra/monitoring/tests/` holds a `promtool` unit test for every rule. Each test feeds the measures that should trigger the alert and checks three things: that the alert fires, that it does not fire too early, and the exact wording of its e-mail. `run.sh test` refuses a rule that has no test. CI runs these tests on the built image (`scripts/images-test.sh`). `scripts/prod-stack-test.sh` then proves the path end to end on the running stack:
- every target is scraped, and every measure above is present;
- nothing fires on a healthy stack except the restore drill not yet run;
- that alert arrives by e-mail over TLS in a stand-in mailbox (`infra/mail-standin/compose.yaml`);
- when Redis is stopped, `RedisDown` arrives too, and the stack recovers once Redis is back.

## Consequences

- Monitoring on the host cannot report the host's own loss. An external uptime check of `https://<portal>/` and of the API's `/health/ready`, from the hosting provider or an independent service, must be set up with the hosting (docs/operations.md). For the same reason `AlertDeliveryFailing` only helps while some other route still works; the external check is that route.
- Existing installations need `scripts/prod-secrets.sh` run again for the three new secrets (`pg_monitor_password`, `redis_monitor_password`, `garage_metrics_token`). After starting the new images, they must run the bootstrap again (`db/bootstrap/apply.sh`, idempotent) to create `pyth_monitor` (docs/operations.md).
- New platform figures belong in `monitoring.platform_metrics()` and in the worker's help text, together with a rule and its test.
- node_exporter sees the disks mounted when it starts, not ones mounted later: Docker Desktop cannot pass later mounts into a container. Restart it after adding a disk.
- Grafana, central logs and tracing remain open. None of them changes anything decided here.
