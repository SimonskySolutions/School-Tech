# 0038 Production end to end: a Stripe stand-in, and rolling back proven in CI

Date: 2026-11-02 · Status: Accepted

## Context

M8.1–M8.7 proved each part of the production stack on its own: images, start-up, sign-in, encryption inside the host, backups, monitoring, restore drills. M8 still has to show two things before handing the platform over:
- **the platform's own work on the production stack:** a family buys something, and a school's website answers on its own domain, both on the same data the restore drill then restores;
- **criterion 7:** releases, rollbacks and upgrades are documented and done, and the previous release's application runs against the new schema.

Two facts limit what can be done:
- **There is no Stripe account** (the owner decided: Stripe later, with everything ready for it). The production stack runs the Stripe adapter (`PAYMENT_PROVIDER=stripe`), so the development payment provider cannot stand in for it there.
- **There is no earlier release on a server.** The hosting is not chosen yet.

Options considered for the payment:

| Option | Verdict |
| --- | --- |
| The development provider in the production stack | Proves the order flow but not the Stripe adapter the production stack runs; production refuses it anyway |
| Our own fake of Stripe's API | Would only agree with our own reading of Stripe's documentation, which the unit tests already check |
| **Stripe's official `stripe-mock`, behind TLS** | **Chosen**: Stripe's own server, which checks every request against Stripe's published API description and answers with Stripe's example objects. It sends no webhooks, so the check signs and sends them as Stripe does |
| Stripe in test mode | The real thing, and still required before go-live (docs/operations.md, "Switching to Stripe"); no account yet |

Options considered for the previous release:

| Option | Verdict |
| --- | --- |
| Start the stack at the previous release, then release the new one | Proves the upgrade, but not the rollback onto a schema the previous release has never seen |
| **Start at the new release, roll back to the previous one, then release the new one again** | **Chosen**: the rollback meets the new schema and the data the new release wrote, and the release after it is an upgrade |
| A fixed old release (for example the first M8 commit) | Drifts further from what would really be rolled back to with every commit |

## Decision

**The API can talk to a stand-in that speaks Stripe's API.** A new setting, `STRIPE_API_URL`, defaults to `https://api.stripe.com/v1`:
- it must be https;
- a live key (`sk_live_`) is refused with any other address, so a live key can only ever reach Stripe itself.

Production does not set it.

**`infra/stripe-standin/compose.yaml`**, used only by the stack check, adds:
- `stripe-mock` (pinned by digest);
- a Caddy in front of it with a certificate from the platform's own authority (`TLS_EXTRA_SERVICES=stripe`);
- `STRIPE_API_URL=https://stripe/v1` for the API, which trusts the authority through `NODE_EXTRA_CA_CERTS`.

The secret key and webhook secret are random test-mode values made by `scripts/prod-secrets.sh`, as Stripe's would be.

**The family's purchase** (`scripts/prod-purchase-check.py`) runs on synthetic data (`scripts/prod-stack-fixture.sql`): School E, billed by "Testing Company", a child, a chess club for 60.00 a term, and a website on `www.school-e.test`. The steps:
1. The parent signs in and sees the club on `/services`.
2. The parent books it through the portal's own booking form.
3. The portal sends the parent to `https://checkout.stripe.com/…`, the address the API received from the stand-in.
4. The check sends `checkout.session.completed` for that checkout to `https://<API_HOST>/webhooks/stripe`, signed with the webhook secret:
   - a wrong signature is refused;
   - the event is accepted;
   - the same event sent again is stored as a duplicate.
5. The worker marks the order paid, and the parent's order page says "Paid".

**The school's website** answers on its verified domain. The gateway issues its certificate on the first visit, after asking the API (`/internal/tls/allowed`). A domain still waiting for its TXT record gets no certificate, and neither does an unknown one.

**The restore drill and the lost-server rehearsal** of M8.7 then run on that data. After the rebuild, the order is still paid.

**Releases are a tag and a compose file.** Every commit's images carry the commit's tag. A release is:
- keep the running release's `compose.production.yaml` and `IMAGE_TAG`;
- put the new ones in place;
- run the migration job while the old release still serves;
- `up -d --wait`.

A rollback puts the previous compose file and tag back and runs `up -d --wait`:
- the schema stays: migrations only expand (expand, then contract in a later release), and production never runs a down migration;
- the previous release's migration job finds nothing to apply.

**Upgrading a component** (PostgreSQL's minor release, Keycloak, Caddy, Redis, Garage, the exporters, pgBackRest, rclone) is a release too:
- its tag and digest change in its Dockerfile;
- CI proves the whole stack and the rollback with it;
- it goes out by the release procedure.

PostgreSQL's major release is the exception: it needs `pg_upgrade` (docs/operations.md, "Upgrades").

**CI proves it on every push.** The images job checks out two commits and treats the previous commit as the previous release. It builds that commit's images as `previous` and keeps its compose file. `scripts/prod-stack-test.sh` (with `PREVIOUS_TAG` and `PREVIOUS_COMPOSE`) then:
1. rolls back to it, on the new schema;
2. checks the previous applications are the ones running, every migration still applied and the health checks passing;
3. checks the parent can still sign in and sees the order paid;
4. releases the current commit again by the procedure and checks the same.

## Consequences

- Every push proves the purchase, the website, the restore and the rollback on the production stack. The images job takes longer (two sets of images); its limit is 60 minutes.
- Stripe is still not validated:
  - `stripe-mock` checks our requests against Stripe's API and answers with Stripe's objects, but its answers are canned, and it says nothing about the dashboard, the webhook endpoint's configuration or real cards;
  - the switch-over steps (docs/operations.md, "Switching to Stripe") and a real test-mode run are still required, and the integration register keeps Stripe "not validated".
- A rollback is only safe while migrations stay expand-only. A migration the previous release cannot work with should fail the CI rollback before it reaches a server, but only where the rollback check touches what it changed: reviewing each migration for expand-only stays necessary.
- The previous commit stands for the previous release. When releases are tagged, CI can roll back to the last tagged release instead.
- The handoff (`docs/handoff.md`) lists what remains to decide and the first steps on a real host.
