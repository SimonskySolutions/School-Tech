# Handoff

Last updated: 2026-11-02, at the end of M8. For whoever runs the platform next: what exists, how to run it, what is still to decide, and the first steps on a real server. The details are in the documents this page links to; this page does not repeat them.

## What exists

The Pythagoras platform: one system for the group's schools.
- **The family portal:** parents book and pay for school services, see orders, documents and messages, give consent, and apply for places.
- **Staff pages:** schools, offerings, admissions, staff records, documents, tasks and reports.
- **Every school's website:** edited in Payload CMS and served on the school's own domain.

| Milestone | What it delivered |
| --- | --- |
| M0 | The database: schemas, roles, row-level security, audit, GDPR foundations |
| M1 | Repository, Keycloak sign-in, every API request under the person's own row-level security |
| M2 | A family's purchase end to end, one order per billing company |
| M3 | A new school and its website set up in the platform, without code changes |
| M4 | Every School Life service: lunches, activities, lessons, trips, transport, uniforms |
| M5 | Admissions: inquiries, applications, offers, the waiting list, enrolment |
| M6 | Staff records, private documents with consent and approvals, tasks and projects |
| M7 | Notifications by e-mail, the accounting export, integrations recorded as awaiting contracts |
| M8 | The production deployment on one Linux host: images, encrypted connections, continuous off-site backups, monitoring with alerts, restore drills, releases and rollbacks, all proven in CI |

The full record of what was built and why: [the implementation plan](implementation-plan.md) and [the decisions](decisions/README.md).

**What CI proves on every push** (`.github/workflows/ci.yml`): the code checks and unit tests; every suite against the development stack; and the production stack started from nothing (`scripts/prod-stack-test.sh`). For the production stack it proves:
- sign-in, with a second factor for staff;
- a family's purchase through a Stripe stand-in;
- a school website on its own domain;
- encryption inside the host;
- backups, with an alert e-mailed;
- a restore drill, and a lost server rebuilt;
- a rollback to the previous commit and the release again.

## Where to look

| For | Read |
| --- | --- |
| Running it on a laptop | [Operations](operations.md), "Local development" (`docker compose up -d --wait`; development accounts under "Development data and accounts") |
| How it is built | [Architecture](architecture.md), [Data model](data-model.md) |
| A production server, from nothing | [Operations](operations.md), "Production stack": first installation, networks, secrets |
| Releasing, rolling back, upgrading | [Operations](operations.md), "Releases, rollbacks and upgrades" |
| Backups, restore drills, losing the server | [Operations](operations.md), "Continuous backups", "Restore drills", "Losing the server" |
| Alerts and what to do about each | [Operations](operations.md), "Monitoring and alerts" |
| External systems and what is validated | [Integration register](integration-register.md) |
| Payments and switching to Stripe | [Operations](operations.md), "Payments" |

## Still to decide

The platform was built so that none of these blocks anything else; each has a place waiting for it.

| Decision | What it needs | Where it goes |
| --- | --- | --- |
| **Hosting** | One Linux host in the EU with Docker Engine and an encrypted disk (sizing: [ADR 0033](decisions/0033-production-topology.md)); ports 80 and 443 open | "Production stack", first installation |
| **The group's domain** | Host names for the portal, sign-in, API and CMS, pointed at the host | `PORTAL_HOST`, `AUTH_HOST`, `API_HOST`, `CMS_HOST` in `.env`; then remove `LOCAL_CERTS` so that Caddy obtains real certificates |
| **Off-site backup storage** | An S3-compatible bucket in the EU, in an account apart from the server's, and a key limited to it | `BACKUP_S3_*` and `backup_s3_secret_key` ("Continuous backups") |
| **SMTP service** | A provider (or the group's server) with TLS, and SPF, DKIM and DMARC for the sending domain | `SMTP_*`, `MAIL_FROM`, `smtp_password`; `ALERT_EMAIL_TO` for the alerts |
| **Stripe** | A test-mode account first; then a live one | "Switching to Stripe" in "Payments"; the integration register says Stripe is not validated until a real test-mode run |
| **Data protection texts and retention periods** | The DPO's approval of processing purposes and retention periods | Retention jobs do nothing until a policy is approved (M0, M5.6) |
| **Real names** | The billing companies' and schools' legal names; the CI checks use placeholders such as "Testing Company" | Entered in the platform by the group administrator; nothing in code |
| **An external uptime check** | Any service outside the host that fetches the portal | Alerts cannot report the host itself being down ("Monitoring and alerts") |
| **Integrations without a contract** | Shkolo, the accounting software, qualified e-signature, SMS or Viber | The integration register and [ADR 0032](decisions/0032-integrations-awaiting-contracts.md); nothing is built for them on purpose |

## The first week on a real server

1. **Install** by "Production stack", first installation. Keep a copy of `/etc/pythagoras/.env` and the secrets directory off the host. Keep **`backup_cipher_pass`, `backup_documents_pass` and `backup_documents_salt`** in the group's password manager: without them no backup can be read.
2. **Replace every placeholder** that `prod-secrets.sh` listed, and restart the services concerned.
3. **Create the first group administrator** (below).
4. **Run a restore drill** at once (`docker compose … run --rm restore-drill`), and enable the monthly timer (`infra/systemd/`).
5. **Fire a test alert**, and check that it reaches `ALERT_EMAIL_TO`. Set up the external uptime check.
6. **Set up the schools in the platform:**
   - the billing companies, the schools and their offerings;
   - the staff, who get their invitations by e-mail;
   - each school's website and domain ("Real domains for school websites").
7. **Before families pay:** switch to Stripe in test mode and run the check in "Switching to Stripe". Then switch to live.

## The first group administrator

A new installation has no users (the production realm imports none) and no group. The first administrator is made by hand, once; everyone after them is invited from the platform. These are the same steps `scripts/prod-stack-test.sh` runs for its member of staff. In the commands, `dc` stands for `docker compose -f compose.production.yaml --env-file /etc/pythagoras/.env`.

**1. The Keycloak account**, through the administration tool inside the container. The console is never public.

```bash
dc exec keycloak bash
```

Inside the container:

```bash
k=/opt/keycloak/bin/kcadm.sh
$k config credentials --config /tmp/kcadm.config --server http://localhost:8080 --realm master --user admin --password "$(cat /run/secrets/keycloak_admin_password)"
$k create users --config /tmp/kcadm.config -r pythagoras -s username=<e-mail> -s email=<e-mail> -s firstName=<given name> -s lastName=<family name> -s enabled=true -s emailVerified=true -i
$k update users/<the id it printed>/execute-actions-email --config /tmp/kcadm.config -r pythagoras -b '["UPDATE_PASSWORD"]'
rm /tmp/kcadm.config
```

The last `kcadm` command e-mails them a link to choose their password; it needs the SMTP service. Without it, set a temporary password instead:

```bash
$k set-password --config /tmp/kcadm.config -r pythagoras --username <e-mail> --temporary
```

It asks for the password. Give it to them by another channel than the e-mail address.

**2. The group, the person and the role**, as the database superuser, in one transaction:

```bash
dc exec -T postgres gosu postgres psql -X -v ON_ERROR_STOP=1 -d pythagoras
```

```sql
BEGIN;
SET LOCAL app.actor = 'operator:<your name>';
INSERT INTO org.education_group (code, name) VALUES ('pythagoras', 'Pythagoras');
WITH g AS (SELECT id FROM org.education_group WHERE code = 'pythagoras'),
     p AS (INSERT INTO people.person (group_id, given_name, family_name, email)
           SELECT id, '<given name>', '<family name>', '<e-mail>' FROM g RETURNING id, group_id),
     l AS (INSERT INTO people.login_identity (person_id, group_id, provider, subject)
           SELECT id, group_id, 'keycloak', '<the Keycloak id>' FROM p)
INSERT INTO access.role_assignment (group_id, person_id, role_code) SELECT group_id, id, 'group_admin' FROM p;
COMMIT;
```

**3. Their first sign-in.** They sign in to the portal with the password and must set up a one-time code, because every member of staff needs one. From then on they work in the platform.

## Known limits

- **One host:** its outage stops the platform until it is restored, within the 4-hour target. The way to grow is in [Operations](operations.md), "Availability limits of the initial topology".
- **Stripe** is proven against Stripe's `stripe-mock`, not against Stripe itself ([ADR 0038](decisions/0038-production-end-to-end.md)). Not built yet: refunds through Stripe, fetching a payment's state from Stripe, expiring a Stripe session when the reservation expires.
- **CMS editors' sign-in** on the production stack is configured like the portal's but not yet tried end to end there.
- **The rollback CI proves** is to the previous commit. Once releases are tagged, roll back to the last tagged release instead (ADR 0038).
- The other open items are listed at the end of [the implementation plan](implementation-plan.md).
