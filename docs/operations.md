# Operations

Status: data services and the identity provider (milestones M0 and M1.1). Application services are added in later milestones.

## Local development

Requirements: Docker Desktop with Compose v2, and Git Bash (Windows) or any POSIX shell. Node.js is not needed yet; tests that need it run in a pinned container.

```bash
bash scripts/dev-secrets.sh
```

```bash
docker compose up -d
```

```bash
bash scripts/db-migrate.sh up
```

```bash
bash scripts/db-seed.sh
```

```bash
bash scripts/db-test.sh
```

```bash
bash scripts/redis-test.sh
```

```bash
bash scripts/identity-test.sh
```

```bash
bash scripts/api-integration-test.sh
```

```bash
bash scripts/web-e2e-test.sh
```

```bash
bash scripts/gateway-test.sh
```

To try it in a browser: open `http://portal.pythagoras.localhost:53000`, choose **Sign in**, and use one of the accounts below with the password in `secrets/keycloak_dev_user_password`.

To call the API by hand as a seeded person, get a token from the development test client and pass it as a bearer token:

```bash
TOKEN=$(curl -s -X POST http://localhost:58080/realms/pythagoras/protocol/openid-connect/token -d grant_type=password -d client_id=pythagoras-dev-tests -d username=anna.ivanova@pythagoras.test --data-urlencode "password=$(cat secrets/keycloak_dev_user_password)" | python -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:53001/me
```

| Service | Host address | Notes |
| --- | --- | --- |
| PostgreSQL 18.6 | `127.0.0.1:55432`, databases `pythagoras` and `keycloak` | Override with `POSTGRES_HOST_PORT`. Superuser only via `docker compose exec -u postgres postgres psql` |
| Redis 8.10.2 | `127.0.0.1:56379` | Override with `REDIS_HOST_PORT`. Users `pyth_queue`, `pyth_health`, `pyth_admin` |
| Keycloak 26.8.1 | `http://localhost:58080`, realm `pythagoras` | Override with `KEYCLOAK_HOST_PORT`. Admin console: `/admin`, user `admin`, password in `secrets/keycloak_admin_password` |
| Gateway (Caddy) | `http://portal.pythagoras.localhost:53000` | Override with `GATEWAY_HOST_PORT`. The front door: the portal, school sites (`school-a.pythagoras.localhost:53000` …) and `api.pythagoras.localhost:53000` (health checks only). `localhost:53000` redirects to the portal. Browsers resolve `*.localhost` without any setup |
| Web app (development mode) | through the gateway only | Sign in with any seeded account below. Reloads within about 2 seconds of a file change |
| Worker | no port | Runs the API service's compiled output as `pyth_worker` / `pyth_queue`; healthy while its heartbeat file is fresh. Logs: `docker compose logs -f worker` |
| API (watch mode) | `http://localhost:53001` | Override with `API_HOST_PORT`. `/health/live`, `/health/ready` are public; every other route needs a Keycloak access token. Starts after the one-off `deps` service has installed dependencies |

### Code toolchain

Node.js and pnpm run inside the `workspace` container (ADR 0012); nothing needs installing on the host.

```bash
bash scripts/pnpm.sh install
```

```bash
bash scripts/check.sh
```

`scripts/pnpm.sh` passes any pnpm command through, for example `bash scripts/pnpm.sh --filter @pythagoras/api test`. Dependencies and build output live in the `ws_*` volumes; `docker compose down -v` removes them together with the databases, so prefer removing only those volumes when you want a clean reinstall.

**Known development gotcha:** the API's watch compiler notices changed files but not a newly created folder under `apps/api/src`. After adding a folder, run `docker compose restart api` (the worker picks up the new output by itself). The same restart helps when the API log shows `EADDRINUSE` after a change: the watcher's new process could not take the port, and the old code keeps answering.

### Background jobs

| Queue | Job | When | What it does |
| --- | --- | --- | --- |
| `events` | one per outbox event | as soon as it is committed (relay polls every second) | Runs the handlers registered for the event type. At-least-once delivery, 8 attempts with exponential backoff; kept 7 days when done, 30 days when failed. Handlers today: `commerce.order_line.cancelled` issues the family's credit for a cancelled lunch day |
| `maintenance` | `audit.ensure-partitions` | 03:00 UTC on the 1st of each month, and at worker start | Creates audit-log partitions three months ahead |
| `maintenance` | `integration.purge-inbound-payloads` | 03:30 UTC daily | Reduces processed provider webhook payloads older than 90 days to identifiers |
| `maintenance` | `commerce.expire-reservations` | every minute | Expires unpaid orders past their reservation time and releases their seats |
| (no queue) | payment events | polls every second | Applies verified provider webhooks stored in `integration.inbound_event`, oldest first. They stay in PostgreSQL because provider payloads can contain personal data |

An outbox event whose payload looks like personal data is never sent to Redis: it stays unpublished with `last_error` explaining why. Find such events with `SELECT event_type, last_error FROM integration.outbox_event WHERE published_at IS NULL AND last_error IS NOT NULL` (as the superuser); they indicate a programming error to fix. Retention jobs that delete personal data are not scheduled until the data protection officer approves retention policies.

If you add a role or a secret to an existing installation, apply it with `bash scripts/db-bootstrap.sh` (idempotent; the first-start hook only runs on an empty volume).

### Lunch menus and dietary needs (ADR 0020)

- Menus: `/school-life/menus` (School Life, principals and kitchens publish; other staff read). Saving a day replaces its menu; tick every allergen a dish contains. The development seed fills each lunch day with a synthetic weekly menu (peanuts on Thursdays).
- Dietary needs: parents use "Dietary needs" next to each child on the home page; School Life and principals see `/school-life/dietary`, unverified first, and School Life verifies there. The kitchen list shows "(not yet verified)" until then, and lists children whose declared allergen is on their lunch first.
- Who read a child's dietary data: `SELECT occurred_at, actor_person_id, resource FROM audit.access_log WHERE subject_person_id = '<child>' ORDER BY occurred_at DESC` (needs `audit.read`, or the superuser).

### Staff records (M6.1, ADR 0028)

- Principals and school administrators keep their school's employment records at "Staff" (`/schools/[id]/staff`, linked on the home page); group administrators and the CEO reach every school's from "Across the group". Record the employer, position, contract, working time and dates; set an end when someone leaves. The page flags anyone with a role in the platform but no current employment, and the reverse: revoking access is a separate step on the school's set-up page.
- Everyone with a role sees their own records at "My employment".
- Do not keep payroll data here (national identification numbers, addresses, salaries, bank details): that stays with the payroll provider until its integration is agreed (M7).
- Qualifications and record checks (M6.2) are on the same page. "Needs attention" lists everyone employed now without a valid criminal record check, teachers without a valid teaching licence, and qualifications or checks that have expired or end within 60 days. For a criminal record certificate, note only the day you saw it and the day it is valid until: never scan, copy or type what it says. A qualification entered by mistake is marked "recorded in error" and no longer counts. Nobody is reminded automatically yet (M7): look at the page.
- Professional development (M6.3) is on the same page: each person's hours for the school year (September to August), attended and planned, and the school's total; "Year before" and "Year after" show other years. Staff add their own training on "My employment"; the principal can add it for them. Mark planned training attended once it has taken place, or cancelled; cancelled training is not counted. Training recorded wrongly cannot be edited: cancel it if it was planned and record it again.

### Accounting export (M7.4)

- Group finance opens "Accounting export" on the home page, chooses the company and the period (last month by default, at most a year) and downloads the CSV. The layout is in `docs/accounting-export.md`; it is the platform's own until the accountants confirm their software and import format, so hand it over as a listing, not as a file to import.
- Book only entries marked `live`. Entries marked `test` come from test payments and are never real money; in development every payment is a test payment.
- The file names no payer or child; each entry has its order number. Every export is in the access log: `SELECT occurred_at, actor_person_id, record_count FROM audit.access_log WHERE resource = 'commerce.accounting_entries' ORDER BY occurred_at DESC`.

### Messages by e-mail (M7.1)

- In development every message goes to the development mailbox: open `http://127.0.0.1:58025` to read what the platform sent. Nothing leaves the machine. Restarting `mailpit` empties it.
- The worker sends what is queued every 5 seconds. A message that cannot be sent is retried after 1, 5 and 30 minutes, then 2 and 6 hours, and is then marked failed. Look for failures: `SELECT created_at, kind_code, person_id, attempts, last_error FROM notify.message WHERE status = 'failed' ORDER BY created_at DESC` (as the superuser, or as the worker). To send one again after fixing the cause, queue it anew under a new key; failed messages are never resent silently.
- What is sent and to whom: a payment confirmation to the payer and an invitation to apply to the invited parent (both always sent); an approval waiting to whoever holds the waiting step's role; a task to the person it is given to (not when they set it themselves); a school's reply to the parent who wrote; consent asked again to each guardian who may consent, when new wording changes what is agreed. Each person turns the ones that are not essential off and on under "Notifications" at the top of the home page, which also lists what was sent to them lately.
- Messages never contain a request's subject, a reply, a child's needs or a document; they say what happened and link to the page, where people sign in.
- Reminders go out once a day at 05:00 UTC (07:00 or 08:00 in Sofia): a task due tomorrow; a summary of one's overdue tasks; to principals and school administrators, once a week, how many staff need their record check or qualifications seen to (no names: the staff page has them); to a family, once, when an offer of a place has three days or less left (always sent). To send them now, for example after the worker was down at that hour: `SELECT * FROM notify.queue_reminders(current_date)` as the worker; it sends nothing twice.
- **Production:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_REQUIRE_TLS=true` (port 587) or `SMTP_SECURE=true` (port 465), `SMTP_USER`, `SMTP_PASSWORD_FILE`, `MAIL_FROM` with the group's own domain and `PORTAL_URL` with https on the worker; it refuses to start otherwise. Before the first message, publish SPF, DKIM and DMARC records for the sender domain as the provider describes, and send a test to a mailbox you control. Keycloak's own messages (setting a password) need the same SMTP settings in the realm's e-mail tab.

### Tasks and projects (M6.7)

- "Tasks" on the home page lists each person's own tasks (overdue ones marked), those they set for others and, for principals, school administrators, the group administrator and the CEO, the overdue tasks of others at their schools. Anyone who works in the group adds tasks for themselves; leaders give tasks to anyone who works at their school now (with a role or a current employment there).
- Leaders start a project for their school (or, for group roles, for the group) and add its tasks on the project's page. Everyone with a task in a project sees all its tasks there. A project closes once nothing in it is to do; cancel what will not be done first.
- The person given a task starts it, puts it back, finishes or reopens it; whoever set it (or the project's owner, or the school's leaders) changes, reassigns or cancels it. Finished tasks are not changed: reopen one to work on it again.
- Nobody is reminded of due or overdue tasks yet (M7): look at "Tasks".

### Consent from families (M6.6)

- Guardians give or withdraw consent for each purpose on their child's "Consents" page (home page, next to the child). Only a verified guardian who may consent for the child can do it, and only for the wording shown; withdrawing takes one click and counts at once.
- Staff look at "Photo consents" for their school before using a photo or a recording: only "Yes" may appear, for that purpose. "No: asked again" means the wording changed and the family has not agreed to the new wording yet; treat it as no.
- The data protection officer publishes wording under "Consent wording". Published wording never changes. Tick "ask families again" when new wording changes what is agreed (for example names as well as photos): every earlier consent then stops counting. Leave it unticked for a correction that changes nothing agreed.
- Who gave a consent and when: `SELECT given_at, given_by_person_id, wording_version, status, withdrawn_at FROM privacy.consent_record WHERE subject_person_id = '<child>'` (needs `privacy.read` or `consent.manage`).
- Consents received on paper are not entered yet: treat those children as not consenting until a guardian consents in the portal.

### Documents (M6.4)

- Each school's documents are at "Documents" on the home page (`/schools/<id>/documents`): the school's own, its staff's and its pupils'. Principals, school administrators and the group administrator file them and add versions; every member of staff reads the school's documents marked "for all staff"; a member of staff finds their own under "My documents" on "My employment".
- Files: at most 10 MB, PDF, PNG, JPEG, text, Word, Excel or OpenDocument. A new file is a new version; earlier versions stay. A document no longer in use is archived, not deleted. Do not file health or dietary information: it belongs in the dietary records.
- "Download" makes a link for you alone that lasts two minutes and works once; every download is in the access log: `SELECT occurred_at, actor_person_id, resource, subject_person_id FROM audit.access_log WHERE action = 'download' ORDER BY occurred_at DESC` (needs `audit.read`).
- The store (`garage`) has no host port and no gateway route. `storage-init` gives the node its role, imports the API's key and creates the bucket; it runs before the API and is safe to run again. Its status: `docker compose exec garage /garage status`; the bucket: `docker compose exec garage /garage bucket info pythagoras-documents`.
- Test data: the reset removes the documents the tests filed; their objects stay in the development bucket under keys nothing refers to. `docker compose down -v` clears everything.
- Approvals (M6.5): on a document's latest version, "Ask for approval" names up to three approvers in order (the principal, the school administrator, the group administrator, the CEO; for a member of staff's document only the last two). Each approver finds it under "Approvals" on the home page once the steps before theirs are approved, downloads the version to read it, and approves it or rejects it with a reason. A rejection ends the request; upload a corrected version and ask again. One person decides only one step of a request, even when they hold two of the roles. An approved version stays approved; a new version needs approval again. A request on its way can be withdrawn by whoever files the document. Nobody is reminded yet (M7): approvers look at "Approvals".
- Objects nothing refers to (a commit that failed after its upload) are found by listing the bucket's keys and comparing them with `SELECT object_key FROM documents.version`; delete those keys only, never a key the table holds.

### Admissions inquiries (M5.1, ADR 0026)

- Every school website has "Ask about a place" (`/inquiry` on the website's host, e.g. `http://school-a.pythagoras.localhost:53000/inquiry`). Families send it without signing in; principals, school administrators and group administrators answer at `/admissions/inquiries` in the portal ("Admissions" on the home page): log calls, e-mails and meetings, and close each inquiry with its outcome.
- The form shows the group's current admissions privacy notice. The seeded notice is synthetic: before production the data protection officer publishes the real text (`admissions.publish_privacy_notice`, as a person with `privacy.manage`; no page yet). Forms opened before a new version are refused once and shown the new text.
- No IP address is stored. If a website receives more than 30 inquiries in an hour, further senders are asked to try again later; the count drops as the hour passes.
- Inquiries that led to no enrolment are to be erased after the DPO's retention period (M5.6, not built yet); until then they stay.

### Intakes and applications (M5.2, ADR 0027)

- Admissions staff open an intake (school, school year such as `2027/28`, grade, places, the dates applications are taken) at `/admissions/applications`, see the applications there and take them into review.
- Parents apply at "Apply for a place" (`/admissions/apply`) for one of their children (they need the consent capability for that child) or for a child new to the group.
- A family that only sent an inquiry has no sign-in yet: on the inquiry, "Invite to apply" creates the parent's record and account. In development the next page shows a one-time temporary password to pass on by phone; production needs the e-mail set-up (`ACCOUNT_SETUP=email`, SMTP in M7). If the address is already known to the group nothing is created; a group administrator links the family by hand.
- The seeded grade 1 intake at School A closes 90 days after the seed first ran; reseeding a fresh database moves it.

### Offers and the waiting list (M5.3)

- On `/admissions/applications` staff offer a place with the date the family must answer by (the offer runs to the end of that day, school time), put an application on the waiting list, or mark it as not offered a place. Staff notes on an application are never shown to the family.
- An intake never has more offers out than places; when every place is offered or accepted, put further applications on the waiting list.
- The family accepts or declines on "Apply for a place". The worker expires unanswered offers every minute (job `admissions.expire-offers`); a declined, expired or withdrawn place goes straight to the first on the waiting list, who has 14 days to answer. Closing the intake stops these automatic offers.
- No e-mail tells a family about an offer yet (M7): contact them yourself when you offer a place.

### Enrolling an accepted place (M5.4)

- When a family accepts, "Enrol the child" appears on the application: give the first school day and, if you like, the class. For a child new to our schools, say how the parent is related; the parent then becomes the child's guardian, verified by you, and the child's record is created from the application.
- A child enrolled from a future date appears among the family's children, but services at the new school can be booked only from that date.
- An enrolment cannot be undone from the admissions page, and no page withdraws or corrects an enrolment yet; until one exists, a mistaken enrolment is corrected in the database by an administrator.

### The School Life day (M4.8)

- `/school-life/day` ("Today at school" on the home page) shows one school on one day: lunch and dietary alerts, clubs and lessons, trips, buses, uniforms to hand over, families' requests waiting and dietary needs to verify. Switch school or day at the top; each part links to the page where the work is done.
- It only summarises the other pages and follows their permissions: the kitchen and the CEO see no requests, and nobody sees another school's day.

### Retention and requests from prospective families (M5.6)

- When a family asks what we hold, open their inquiry or application, choose "The family asks…" and download the file; send it to them. When they ask to be forgotten, erase it there (tick the confirmation). When they want no more news about open days, record it there. Each of these is recorded as a completed data subject request.
- An erased inquiry or application keeps no name, address, child or message, but still counts in "Admissions in numbers". An enrolled child's application is part of their school record and is not erased from admissions. An invited parent's sign-in and record are erased under the general person erasure (ADR 0006).
- The worker erases unsuccessful inquiries and applications every day at 04:00, but only under an approved retention policy `admissions.unsuccessful`. The seed's policy (12 months) is a draft. To approve the period the DPO has set, as the privacy officer or a database administrator:

  ```sql
  UPDATE privacy.retention_policy
     SET retain_for = interval '12 months', status = 'approved', approved_at = now(), approved_by_person_id = '<privacy officer person id>'
   WHERE code = 'admissions.unsuccessful';
  ```

### Enrolment fees (M5.8)

- A school's enrolment fee is an offering like any other: on the school's set-up page add an offering of the "Enrolment fee" service with a one-off price; it is billed by the school's company.
- On `/admissions/applications` choose the fee for each intake (or "No fee"). Once a child is enrolled from that intake the family sees "pay" on "Apply for a place" and pays through the normal checkout; afterwards it shows as paid. The database refuses a second fee for the same child.
- If an expired order for the fee is paid late after the family has already bought it again, both payments are confirmed; refund one of them.

### Admissions in numbers (M5.5)

- `/admissions/pipeline` shows applications per intake (places, free, new and in review, waiting, offered, accepted, enrolled, not placed, and how many came after an inquiry) and inquiries per website, optionally since a date. The CEO opens it from "Admissions per school" in the reports and sees every school's numbers, never names.
- Admissions staff also see what to follow up: inquiries unanswered after 3 days, applications not reviewed after 7, offers ending within 3 days and accepted places to enrol, each linking to its page.

### Families' requests (M4.7)

- Parents write under "Messages to the school" next to each child (absence, dietary change, who collects, question, other); the request goes to the child's school.
- School Life, principals and school administrators answer at `/school-life/requests` (waiting first; filters for each status). "Working on it" tells the family it is being handled; an answer marks it answered; the family's reply reopens it; either side can close it.
- No e-mail is sent yet on new requests or answers (M7), so staff check the page.

### Uniforms (ADR 0025)

- Setting up: add a uniform offering on the school's set-up page (its own price is not used), then on "Sizes, prices and stock" (`/schools/<id>/uniforms`) add each size or colour with its code and price, and take in a delivery to put it on sale.
- Families choose how many of each size on the booking page; what is left is shown, and an unpaid order holds its items for 30 minutes.
- Staff hand paid items over on the same page ("Paid, to hand over"), record deliveries and counted corrections (with a reason), and see sizes at or below their reorder level under "Low stock". A correction can never take the store below what is held for orders; every change is in the stock ledger (`catalog.stock_movement`).

### Transport (ADR 0024)

- Setting up a route for a term: add a transport offering on the school's set-up page (priced per term), add "A whole term (transport)" calendar with the first and last day, the seats as places and the term's name in the Room field, then open "Route and stops" to set the vehicle and weekdays and add the stops in order. One route offering has one term; the next term is a new offering.
- Families choose a stop when they buy a seat; seats are bought before the term starts.
- The driver's list: `/school-life/transport?from=YYYY-MM-DD` shows each route running that day with the stops in order and who boards at each.

### Trips and consent (ADR 0023)

- Setting up a trip: add a trip offering on the school's set-up page, write its consent wording there ("Consent wording"), then add a "One day (trips)" calendar with the date, times, place and number of places. Without wording the trip cannot be booked. Changing the wording makes a new version: guardians give permission again before booking; places already booked stay.
- Guardians read the wording and give permission under "Trips" next to each child, with an emergency contact for the day; only a guardian with the consent capability can. Withdrawing before the trip cancels a paid place and the payment becomes credit within a minute; while a payment is open the withdrawal waits.
- Staff see who is coming at `/school-life/trips`: class, permission, emergency contact and, for School Life, principals and kitchens, dietary and health needs (every view is in the access log). A permission given on paper is recorded through the API (`POST /school-life/trips/:sessionId/permissions`, staff with `consent.manage`); there is no page for it yet.

### Individual lessons (ADR 0022)

- Selling lessons: on the school's set-up page add a lessons offering with the price "per package of lessons" and the number of lessons (1 for single lessons). Parents buy packages on the booking page.
- Teachers, rooms and times: `/schools/<id>/lessons` (linked from the offering, from home for school staff, and from the School Life section). Add teachers and rooms, give each weekly hours, then "Create lesson times" for a date range and length; it fills the hours the teacher and the room share and leaves out anything that would clash, so running it again is safe.
- Families book on "Lessons" next to each child. Cancelling at least 24 hours before returns the lesson to the package; later, it counts as used. Unused lessons do not expire and are not refunded automatically.

### Club eligibility and attendance (ADR 0021)

- Who may take a club: on the school's set-up page, under each club, "Who may take it" (grades as the school names them, and ages in whole years on the day). Bookings already made stay when the rules change. An age rule needs the child's date of birth on their record.
- Registers (`/school-life/registers`): once a meeting has started, teachers, principals, school administrators and School Life mark each child Attended or Absent; corrections are allowed and recorded. Parents see it under "Clubs and attendance".

### Websites and the CMS (ADR 0017)

- School and group websites: `http://school-a.pythagoras.localhost:53000` (also `school-b`, `school-c`, and `pythagoras.localhost` for the group). They show the website's published CMS pages, or a start page built from the platform when there is none.
- The CMS admin: `http://cms.pythagoras.localhost:53000/admin`, "Sign in with your Pythagoras account" (ADR 0019): `admin@pythagoras.test` is a CMS administrator and `schoollife@pythagoras.test` an editor, with the development users' password (`secrets/keycloak_dev_user_password`). Who may edit is the client role `cms-admin` or `cms-editor` of the Keycloak client `pythagoras-cms` (Keycloak admin console: Users → the person → Role mapping); which websites an editor works on is set in the CMS. Without a role, sign-in is refused. Password sign-in (the seeded `editor@pythagoras.test`) works only because the development stack sets `CMS_PASSWORD_LOGIN=true`; never set it in production. If you add this to an existing installation: `bash scripts/dev-secrets.sh`, `bash scripts/keycloak-reload-realm.sh`, then `docker compose up -d --force-recreate keycloak cms`. The development seed creates the four websites as tenants and School A's start page; drafts are never shown on the websites.
- The CMS has its own database `pythagoras_cms` (role `pyth_cms`, secret `secrets/pg_cms_password`) and session secret (`secrets/cms_payload_secret`). If you add the CMS to an existing installation: `bash scripts/dev-secrets.sh`, `docker compose up -d --force-recreate postgres`, `bash scripts/db-bootstrap.sh`, then `docker compose up -d cms`.
- A new school's website: on the school's set-up page, "Create the school's website". It answers on `http://<school code>.pythagoras.localhost:53000` once the school is active. The API adds its space in the CMS with the platform key (`secrets/cms_platform_api_key`, shared by the API and the CMS).
- The CMS log shows many `watch error … No such file or directory` lines from the development file watcher; they are harmless.

## Development data and accounts

`scripts/db-seed.sh` loads `db/seeds/development.sql`: synthetic data only, idempotent, and refused for any database other than the local `pythagoras`. It contains one company, **Testing Company** (placeholder name), billing **School A**, **School B** and **School C**; their websites under `*.pythagoras.localhost`; lunch, chess, robotics and tuition offerings with per-school prices; the next 20 school days of lunch and eight weeks of club sessions.

All accounts share one generated password, stored in `secrets/keycloak_dev_user_password`. Sign in through the web app at `http://portal.pythagoras.localhost:53000`.

| Account | Role | Sees |
| --- | --- | --- |
| `ceo@pythagoras.test` | CEO | All schools; no health data |
| `admin@pythagoras.test` | Group administrator | All schools; configuration |
| `finance@pythagoras.test` | Group finance | Finance across schools |
| `schoollife@pythagoras.test` | School Life coordinator | Services, bookings and dietary needs across schools |
| `dpo@pythagoras.test` | Data protection officer | Privacy records, audit log |
| `principal.a@pythagoras.test`, `principal.b@…`, `principal.c@…` | Principal | Their own school |
| `kitchen.a@pythagoras.test` | Kitchen, School A | Bookings and dietary needs at School A |
| `teacher.b@pythagoras.test` | Teacher, School B | School B enrolments and bookings |
| `anna.ivanova@pythagoras.test` | Parent | Mila (School A, peanut allergy) and Boris (School C) |
| `hristo.georgiev@pythagoras.test` | Parent | Kalina (School B) |
| `teodora.marinova@pythagoras.test` | Parent, request pending | Nothing until a principal verifies the relationship |
| `unlinked@pythagoras.test` | None | Signs in to Keycloak, but has no person record: the platform must refuse it |

The realm file `infra/keycloak/realm/pythagoras-realm.json` is a development realm: it contains these users and the `pythagoras-dev-tests` password-grant client. It is imported only when the realm does not exist yet; after editing it, run `bash scripts/keycloak-reload-realm.sh` (deletes the realm and restarts Keycloak, which imports it again; synthetic users keep their ids, accounts created since are removed).

**Accounts for new people (ADR 0016).** A group administrator creates a registered person's sign-in account with `POST /admin/people/<person id>/account`. The API uses the `pythagoras-provisioning` service account (secret `secrets/keycloak_provisioning_client_secret`, from `scripts/dev-secrets.sh`). In development the answer contains a one-time temporary password, which the person must change at first sign-in; it is shown only once. Production must set `ACCOUNT_SETUP=email` and configure SMTP in the realm (M7). If the API log says `PROVISIONING_CLIENT_SECRET not set`, accounts cannot be created.

## Payments

Development uses the **development payment provider** (ADR 0010): no money moves, and every page that shows such a payment says so. A purchase goes: `/services` in the portal → the provider's page at `http://api.pythagoras.localhost:53000/dev-payments/checkout/…` (pay or decline) → back to `/orders/<id>`, which shows "Paid" only after the worker has applied the signed webhook (a second or two).

Useful checks, as the superuser (`docker compose exec -u postgres postgres psql -d pythagoras`):

- Events not applied: `SELECT provider, event_type, processing_status, attempts, last_error FROM integration.inbound_event WHERE processing_status IN ('received', 'failed') ORDER BY received_at;`. A `failed` event (for example an amount mismatch) needs a person: check it with the provider, then fix the payment by hand.
- Remove all test orders and bookings, and the schools the onboarding tests add (codes starting `test-`, with their offerings, sessions, staff and "Test company" billing entities), keeping the seeded schools, catalogue and people: `bash scripts/db-reset-test-data.sh` (refuses unless every person is synthetic). The identity, API integration and end-to-end scripts run it first.

**Switching to Stripe (test mode)**, when the account exists:

1. In the Stripe dashboard (test mode), create a webhook endpoint for `https://<API_HOST>/webhooks/stripe` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`.
2. Put the secret key and the endpoint's signing secret in the secret store as files, and give the API `STRIPE_SECRET_KEY_FILE` and `STRIPE_WEBHOOK_SECRET_FILE`, plus `PAYMENT_PROVIDER=stripe`. The API refuses to start with `stripe` and no keys; the development checkout pages then answer 404.
3. Locally, forward events with the Stripe CLI (`stripe listen --forward-to localhost:53001/webhooks/stripe`) and use its signing secret.
4. Run one payment with a Stripe test card, then resend the same event from the dashboard: the second delivery must be stored as a duplicate and change nothing. Only then mark Stripe "validated" in the integration register.

## Production images and CI

Every service runs from an image (ADR 0033). Build them all from the repository root:

```bash
for image in api web cms keycloak migrate postgres redis gateway garage pgbouncer; do docker build -f infra/images/$image.Dockerfile -t pythagoras-$image:local .; done
```

```bash
bash scripts/images-test.sh
```

| Image | What it is | Runs as |
| --- | --- | --- |
| `pythagoras-api` | The API; also the worker with `node dist/worker/main.js` | `node` |
| `pythagoras-web` | The portal and the school websites | `node` |
| `pythagoras-cms` | The website editor; applies its own generated migrations (`apps/cms/migrations`) when it starts | `node` |
| `pythagoras-keycloak` | Keycloak built for PostgreSQL with the Pythagoras theme, started with `start --optimized` | `1000` |
| `pythagoras-migrate` | The one-off migration job: dbmate with `db/migrations` inside. Reads `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_PASSWORD_FILE`, `DB_SSLMODE` (default `verify-full`) and `DB_SSLROOTCERT` | `65534` |
| `pythagoras-postgres` | PostgreSQL with `infra/postgres` configuration and the first-start bootstrap | starts as root, runs as `postgres` |
| `pythagoras-redis` | Redis with its configuration and the ACL built from secret files | starts as root, runs as `redis` |
| `pythagoras-gateway` | Caddy with `Caddyfile.production` | root, with every capability dropped except binding ports 80 and 443 (`no-new-privileges` blocks the file capability an unprivileged Caddy would need) |
| `pythagoras-garage` | Garage with `infra/garage/garage.production.toml` and data directories it owns | `1000` |
| `pythagoras-pgbouncer` | PgBouncer 1.26.1 (the PostgreSQL project's package) with `infra/pgbouncer/pgbouncer.ini` | `postgres` |

The build context (`.dockerignore`) admits only the files the images copy, named one by one; `secrets/` never enters it. `scripts/images-test.sh` checks that the application images run unprivileged, that no image holds a file named like one of the platform's secrets, that the migration job carries exactly the repository's migrations, and that Keycloak was built for PostgreSQL with the theme.

**Changing a CMS collection.** Development creates the tables directly; production applies migrations. After changing a collection, generate one in the development CMS container and commit it: `docker compose exec cms sh -c "cd apps/cms && pnpm exec payload migrate:create <name>"`.

GitHub Actions (`.github/workflows/ci.yml`) runs the code checks, builds every production image, checks the images and starts the production stack from them (`scripts/prod-stack-test.sh`), and runs every suite against the development stack, on each push and on pull requests into `Dev` and `main` (ADR 0015).

### Real domains for school websites (ADR 0018)

On the school's set-up page, an administrator adds the domain (for example `www.school-d.bg`) and gives the school's IT contact two DNS changes:

1. **Proof of control:** the TXT record shown on the page, name `_pythagoras-verify.<domain>`, value `pythagoras-site-verification=<token>`.
2. **Pointing the domain at the platform:** an A/AAAA record (or a CNAME) for the domain to the production gateway.

The worker checks pending domains every minute (each at most every five minutes) and marks the domain verified when the TXT record is found; "Check again now" asks for the next run. After 14 days without the record a domain becomes "failed"; fix the record and check again. Once verified, and the school's website is live, the website answers on the domain and the gateway obtains its HTTPS certificate on the first visit. **Keep the TXT record:** verified domains are checked again every day. If it is missing, the set-up page shows a warning with the date the domain will stop; after three days without it the domain stops answering until the record is back and the domain is checked again.

### Production gateway

`infra/gateway/Caddyfile.production` serves HTTPS. It needs `ACME_EMAIL`, `PORTAL_HOST`, `AUTH_HOST`, `API_HOST` and `CMS_HOST`, and DNS records pointing the portal, identity, API, CMS and every school domain at the gateway host, with ports 80 and 443 open for certificate issuance. School domains get certificates only once the platform lists them as verified domains of a live website. `LOCAL_CERTS=local_certs` makes Caddy sign every certificate with its own authority instead; it is for the local and CI proof of the production stack only.

## Production stack (M8.2)

`compose.production.yaml` runs the platform on one Linux host from the images above (ADR 0033). Nothing from the repository is needed on the host except that file: settings come from an env file, secrets from a directory of files.

**First installation**

1. Install Docker Engine with the Compose plugin; open the firewall for 80 and 443 only.
2. Copy `.env.production.example` to `/etc/pythagoras/.env` (mode `0600`, owned by root) and fill it in: `IMAGE_TAG`, the host names, `ACME_EMAIL`, the SMTP service, `STORAGE_ACCESS_KEY_ID`, `BACKUP_STORAGE_ACCESS_KEY_ID` and the off-site backup storage (`BACKUP_S3_*`, below).
3. Create the secrets: `sudo bash scripts/prod-secrets.sh /etc/pythagoras/secrets`. The directory is `0700` and root's; the files are `0444` because the containers read them as unprivileged users. Secrets a provider issues come from the environment (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_PASSWORD`, `BACKUP_S3_SECRET_KEY`); without them the script writes placeholders and lists them. Payments, e-mail and backups fail until the placeholders are replaced; nothing else does. The script also prints new key ids for `STORAGE_ACCESS_KEY_ID` and `BACKUP_STORAGE_ACCESS_KEY_ID`. **Copy `backup_cipher_pass`, `backup_documents_pass` and `backup_documents_salt` to a safe place off the host** (the group's password manager): without them no backup can be read after losing the server.
4. Put the images on the host: `docker compose -f compose.production.yaml --env-file /etc/pythagoras/.env pull` from the registry in `IMAGE_REGISTRY`, or `docker load` of the images CI built for that commit.
5. Start: `docker compose -f compose.production.yaml --env-file /etc/pythagoras/.env up -d --wait`.

**What starts, in order.** PostgreSQL, Redis and Garage first; then `migrate` (the platform's migrations) and `storage-init` (the object store's layout, key and bucket), which run once and exit; then Keycloak, the API, the worker, the CMS (which applies its own migrations), the web server and finally the gateway. The backup service starts once PostgreSQL is healthy and the object store is set up; it is healthy once the write-ahead log reaches the off-site storage and a backup exists, so on a new installation `up --wait` also waits for the first full backup. Each waits for the health check or the successful exit of what it depends on, so a failing migration leaves the applications unstarted.

| Network | Members | Reach |
| --- | --- | --- |
| `edge` | gateway, web, API, CMS, Keycloak | The gateway routes to the applications; outbound for Stripe and Keycloak's e-mail |
| `data` (internal) | PostgreSQL, PgBouncer, Redis, Garage, and their clients: API, worker, CMS, Keycloak, `migrate`, `storage-init`, `backup` | No way out; the gateway and the web server are not on it |
| `egress` | worker | Outbound for SMTP and the DNS checks of school domains |
| `offsite` | `backup` | Outbound to the off-site backup storage only (M8.5) |

Only the gateway publishes ports (`HTTP_PORT`, `HTTPS_PORT`, default 80 and 443). Every container has `no-new-privileges`, a restart policy, bounded logs and a CPU and memory limit; the application containers also drop every capability and have read-only filesystems with `/tmp` in memory. Data lives in the volumes `pg_data`, `redis_data`, `garage_meta`, `garage_data` and `gateway_data` (certificates and the ACME account); `pg_socket` only shares PostgreSQL's local socket with the backup service.

**A release**

```bash
docker compose -f compose.production.yaml --env-file /etc/pythagoras/.env pull
```

```bash
docker compose -f compose.production.yaml --env-file /etc/pythagoras/.env run --rm migrate
```

```bash
docker compose -f compose.production.yaml --env-file /etc/pythagoras/.env up -d --wait
```

Set the new `IMAGE_TAG` first. The migration job runs while the previous version is still serving; if a migration fails its transaction rolls back, the command exits non-zero and nothing is replaced. Fix it with a new migration and release again (migrations are expand, then contract, so the previous version works with the new schema). Rolling back the applications is setting the previous `IMAGE_TAG` and running the last command.

**The proof.** `bash scripts/prod-stack-test.sh [tag]` starts the stack from nothing under the project name `pythagoras-prod-check`, with throwaway secrets, the `*.pythagoras.test` host names and the gateway's own certificate authority (`LOCAL_CERTS=local_certs`) on ports 54080 and 54443 (`PUBLIC_PORT=:54443`, so the public addresses carry the port), and checks the start-up order, health, networks, published ports, HTTPS with HSTS, the redirect from HTTP, that the identity console and internal routes are not public, that every migration is applied, that a failing migration stops a release without changing the database or the running version, and the container restrictions; then it removes everything (`KEEP=1` keeps it running). It also checks the production realm (no users or development client, the step-up flow, e-mail, events) and signs in through the portal over HTTPS as a parent, with a password, and as a member of staff, who must first set up a one-time code and then enter it (`scripts/prod-signin-check.py`). It also checks the connections inside the host: PostgreSQL and PgBouncer refuse anything without TLS, a certificate is refused for a name it does not carry, Redis answers only over TLS, every network connection PostgreSQL holds is TLS 1.3, and the API and the worker reach it only through PgBouncer. And it checks the backups against a stand-in for the off-site storage (`infra/backup-standin/compose.yaml`): an encrypted repository with a full backup from the first start, a change archived within the minute, `pgbackrest check`, a document copied with its name and contents encrypted and moved aside once deleted, the backup's key unable to change the documents, a differential backup holding the platform's, Keycloak's and the CMS's databases, and `pgbackrest verify`. CI runs it on every push.

### Encrypted connections inside the host (M8.4)

`scripts/prod-secrets.sh` also makes a private certificate authority (`tls_ca_crt`, with its key `tls_ca_key`, which no container receives) and a certificate for each data service: `postgres`, `pgbouncer` and `redis`, each valid for its service name, `localhost` and `127.0.0.1`. Everything uses TLS 1.3 and checks the server's certificate against that authority and the name it connected to:

| Client | Connects to | How |
| --- | --- | --- |
| API, worker | PgBouncer (`pgbouncer:6432`), which connects to PostgreSQL | `DB_SSL_ROOT_CERT_FILE`; PgBouncer verifies PostgreSQL (`server_tls_sslmode = verify-full`) |
| Worker | Redis (`redis:6379`, TLS only) | `REDIS_TLS_CA_FILE` |
| CMS | PostgreSQL | `DB_SSL_ROOT_CERT_FILE` |
| Keycloak | PostgreSQL | `sslmode=verify-full` in `KC_DB_URL` |
| Migration job | PostgreSQL | `DB_SSLMODE=verify-full`, `DB_SSLROOTCERT` |

The API and the worker refuse to start in production without the authority's certificate. PostgreSQL refuses any network connection without TLS (`hostnossl … reject`).

**PgBouncer** pools in transaction mode: a server connection is held for one transaction, which is how the platform sets its request context (`set_config(…, true)` inside each transaction). Nothing in the API or worker uses session state, advisory locks or `LISTEN`; keep it that way, or connect that code to PostgreSQL directly. Keycloak (prepared statements over JDBC), the CMS and the migration job connect to PostgreSQL directly. Limits: 400 clients, 20 server connections per role (60 in all) against PostgreSQL's 120.

**Renewing the certificates.** They are valid for 825 days, the authority for ten years. Delete the service's two files (`tls_<service>_crt`, `tls_<service>_key`), run `scripts/prod-secrets.sh` again and restart that service: `docker compose … up -d --force-recreate <service>`. To replace the authority, delete `tls_ca_*` and every `tls_*` file, run the script, and recreate every service.

### Continuous backups (M8.5, ADR 0035)

pgBackRest 2.60.0 and rclone v1.75.2, both in the PostgreSQL image. PostgreSQL archives every write-ahead log segment (`archive_mode = on`, `archive_timeout = 60`) to the `backup` service over pgBackRest's TLS protocol with its certificate; the backup service writes it, encrypted, to the off-site storage. It is the only service that holds the storage's key and the passphrases, and the only one on the `offsite` network.

| What | When (UTC) | Kept |
| --- | --- | --- |
| Write-ahead log | Continuously, at least every minute | As long as the backups it belongs to |
| Full backup | Sundays at 01:00 (`BACKUP_FULL_DAY`, `BACKUP_HOUR`), when the newest full is a week old, and on the first start | The newest 4 |
| Differential backup | The other days at 01:00 | With its full backup |
| Documents (rclone, `sealed:current`) | Every 5 minutes and before each database backup | Deleted objects under `sealed:removed/<time>` for 35 days |

Everything is encrypted before it leaves the host: the repository with AES-256 (`backup_cipher_pass`), the documents' names and contents with rclone's `crypt` (`backup_documents_pass`, `backup_documents_salt`). The backup service reads the documents with a key of its own that may only read the bucket (`BACKUP_STORAGE_ACCESS_KEY_ID`, made by `storage-init`).

**The off-site storage.** Any S3-compatible service in the EU, in an account separate from the server's. Create one bucket (for example `pythagoras-backups`) and a key that may only list, read, write and delete in it; set `BACKUP_S3_ENDPOINT`, `BACKUP_S3_PORT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY_ID` and `BACKUP_S3_URI_STYLE` (`path` or `host`, whichever the provider documents) in `.env`, and the key's secret as `backup_s3_secret_key` (`BACKUP_S3_SECRET_KEY=… scripts/prod-secrets.sh …`, or write the file). pgBackRest keeps its files under `pgbackrest/`, rclone under `documents/`. Do not enable the provider's own lifecycle rules on the bucket: pgBackRest expires its backups itself. Until a provider is chosen, the stand-in (`infra/backup-standin/compose.yaml`, a Garage node behind TLS) shows the whole cycle locally.

**Looking at the backups**, through the backup service, which sets up the repository's settings:

```bash
docker compose -f compose.production.yaml --env-file /etc/pythagoras/.env exec backup pythagoras-backup pgbackrest --stanza=pythagoras info
```

`pythagoras-backup full`, `diff` and `documents` take one now; `pythagoras-backup pgbackrest --stanza=pythagoras check` proves the archive end to end, `… verify` checks every file in the repository against its checksum. `pythagoras-backup rclone lsf -R sealed:current` lists the documents as they are off the host, decrypted.

**What to expect.** On a new installation PostgreSQL logs a few failed `archive-push` attempts in the seconds before the backup service is up; they stop by themselves and nothing is lost (the log waits in `pg_wal`). If the off-site storage is unreachable later, the same happens until it returns, and `pg_wal` grows meanwhile: monitoring (M8.6) alerts on failed archiving and on the age of the newest backup. A failed scheduled backup is retried after 30 minutes.

**Restoring** is the M8.7 drill and runbook: documents first (`sealed:current` plus what was moved aside up to the chosen moment), then the database with `pythagoras-backup pgbackrest --stanza=pythagoras restore` onto an empty data directory, to the latest moment or a point in time (`--type=time --target=…`). Erasures completed after the chosen moment are applied again from `privacy.data_subject_request`.

## Identity provider in production (M8.3, ADR 0034)

- Keycloak runs `start --optimized --import-realm` from the platform's image, behind the gateway on `AUTH_HOST`, with TLS ending at the gateway (`KC_PROXY_HEADERS=xforwarded`).
- **The realm** is `infra/keycloak/realm-production/pythagoras-realm.json`, generated from the development realm: no users except the provisioning service account, no `pythagoras-dev-tests` client, the portal and CMS redirecting only to their own callbacks. After changing the development realm, regenerate it (`docker compose run --rm workspace node infra/keycloak/production-realm.mjs`) and commit both; `scripts/check.sh` fails while it is out of date. It is imported on the first start only: an existing realm is never overwritten, so change a running one with the administration tool and the generator together.
- **Staff sign in with a second factor.** Anyone holding a role must have signed in at the `mfa` level (`STAFF_SECOND_FACTOR=required`, which production insists on); the portal asks for it, and the first time the person sets up an authenticator app (any TOTP app: 6 digits, 30 seconds). Parents sign in with a password. A role granted or revoked applies at the next request. **A lost phone:** in the administration tool, remove the person's one-time-code credential (`kcadm.sh get users/<id>/credentials -r pythagoras`, then `delete users/<id>/credentials/<credential id>`); the next sign-in sets up a new one.
- **E-mail** (password reset, address verification, the set-up e-mail for new accounts) goes through the SMTP service in `.env`, with STARTTLS or TLS and the `smtp_password` secret; the sender is `MAIL_FROM`. These are filled in when the realm is imported; afterwards change them in the realm.
- **Events:** sign-in events are kept 30 days; admin events without request details, so they copy no personal data. Read them with `kcadm.sh get events -r pythagoras`.
- **The console is not public:** the gateway answers 404 for `/admin`. Use the administration tool inside the container:

```bash
docker compose -f compose.production.yaml --env-file /etc/pythagoras/.env exec keycloak bash -c '/opt/keycloak/bin/kcadm.sh config credentials --config /tmp/kcadm.config --server http://localhost:8080 --realm master --user admin --password "$(cat /run/secrets/keycloak_admin_password)"'
```

  then `kcadm.sh <command> --config /tmp/kcadm.config` in the same container, reached over SSH to the host. The web console is not set up for production use.
- The `keycloak` database is in every backup, with `pythagoras` and `pythagoras_cms` (one cluster, ADR 0035).

Passwords are in `secrets/` (git-ignored), one file per role. For an administrative session as the superuser (local socket only):

```bash
docker compose exec -T -u postgres postgres psql -d pythagoras -c "SELECT now()"
```

Data lives in Docker volumes (`pg_data`, `redis_data`, `pg_backups`), not in the project folder. This matters here: the project folder is synced by OneDrive, and database files and backups must never be synced to a personal cloud.

## Migrations

- `bash scripts/db-migrate.sh up` applies pending migrations; `status` lists them.
- Migrations run as `pyth_migrator` with a 10 s lock timeout, so a migration that would block live traffic fails instead of waiting.
- `scripts/db-test.sh` proves on every run that all migrations apply to an empty database, roll back completely and re-apply.
- **Production rolls forward only.** If a migration fails, the transaction rolls back and the release stops; fix it with a new migration. Never run `rollback` against production data.
- **Expand, then contract.** A migration must work with the application version before it, so the application can be rolled back without touching the database. Remove old columns in a later release.

## Backups and restore

```bash
bash scripts/db-backup.sh
```

```bash
bash scripts/db-restore-check.sh
```

- `db-backup.sh` writes a compressed `pg_dump` (custom format, zstd) and a SHA-256 checksum to the `pg_backups` volume, as `pyth_backup`, and keeps the newest 7 (`BACKUP_KEEP`).
- `db-restore-check.sh` verifies the checksum, restores into a scratch database in one transaction, and compares the row count of every table with the source. The test suite runs it on synthetic data every time.
- **Container images are not backups**, and neither is the Docker volume: losing the host loses both.

### Restoring the development database

1. Stop anything that writes: `docker compose stop` for application services (none yet).
2. `docker compose exec -u postgres postgres psql -d postgres -c "DROP DATABASE pythagoras WITH (FORCE)"`
3. Recreate it with the `CREATE DATABASE` statement in `infra/postgres/initdb/10-bootstrap.sh`.
4. `docker compose exec -u postgres postgres pg_restore --dbname pythagoras --single-transaction /backups/<file>.dump`
5. `docker compose exec -u postgres postgres psql -d pythagoras -v dbname=pythagoras -f /opt/pythagoras/db/bootstrap/database.sql`
6. `bash scripts/db-migrate.sh status` must show no pending migrations, or apply them.

### Production

- **Continuous backups** (M8.5, ADR 0035): pgBackRest with the write-ahead log archived at least every minute, a full backup weekly and a differential daily, encrypted, to off-site S3-compatible storage in the EU; the documents copied every 5 minutes and before each backup. See "Continuous backups" under the production stack. Targets (ADR 0033): at most 5 minutes of data lost, 4 hours to restore service.
- **Retention**: four weekly full backups, so any moment of the last four to five weeks can be restored; longer-term copies only per the DPO-approved retention policy.
- **Restore drills** (M8.7): an automated restore to a scratch host with the row-count check, its time measured against the 4-hour target; a full disaster-recovery rehearsal with timings recorded.
- **Documents**: the bytes live in the object store, not the database; they are copied off-site before each database backup, so every version the database knows has its object. Restore the objects first, then the database. Garage also snapshots its metadata every 6 hours (`metadata_auto_snapshot_interval`).
- **Redis**: no backup is needed for correctness. PostgreSQL's outbox is the source of truth; after losing Redis, the worker re-enqueues unpublished outbox events and expiry jobs from PostgreSQL. RDB snapshots and the AOF on the volume cover ordinary restarts.

## Upgrades

- **PostgreSQL minor release** (quarterly): change the image tag and digest in `compose.yaml`, `docker compose up -d postgres`. No data change.
- **PostgreSQL major release** (19 is due late 2026): wait for 19.1 or 19.2; test with `pg_upgrade --link` on a restored copy (the volume is mounted at `/var/lib/postgresql` for this), run the full test suite, then upgrade with a backup taken immediately before.
- **Redis**: change the tag and digest, restart; run `scripts/redis-test.sh`.
- **Garage**: v2.4.1 now; v2.5.0 (2026-10-24) rewrites the resync manager, so wait for a patch release, read its notes, then change the tag and digest, restart, and run the documents integration test. A major release needs its migration notes followed on a copy first.
- **pgBackRest and rclone**: pinned in `infra/images/postgres.Dockerfile` (the package version, and rclone's release with its checksums). PostgreSQL and the backup service always run the same image, so they upgrade together. Read the release notes for repository format changes; run `pythagoras-backup pgbackrest --stanza=pythagoras check` and take a full backup after the release.
- **Rotating a password**: write the new value to the secret file, re-run `db/bootstrap/cluster.sql` as the superuser (it applies `ALTER ROLE … PASSWORD` from the secrets), restart the services that use that role. For Redis, restart the container: the ACL file is regenerated from the secrets on start.

## Production configuration differences

| Area | Development | Production |
| --- | --- | --- |
| Transport security | No TLS inside the Compose network | TLS 1.3 to PostgreSQL, PgBouncer and Redis with certificates from the platform's own authority, verified by every client (M8.4); `hostssl` only (`infra/postgres/pg_hba.production.conf`); Redis on its TLS port only |
| Storage | Docker volume | Encrypted disk; managed PostgreSQL is acceptable if it supports RLS, the roles above, and EU hosting |
| Memory settings | Sized for a laptop | `shared_buffers` ~25 % of RAM, `effective_cache_size` ~50–75 % |
| Connections | Direct | The API and the worker through PgBouncer in transaction mode (their request context is set per transaction); Keycloak, the CMS and the migration job directly |
| Secrets | Files in `secrets/` | Host secret store or the platform's secret manager; never in images or the repository |
| Logs | Docker `local` driver | Shipped to central logging; PostgreSQL never logs query parameters, so logs carry no personal data from queries |
| Redis host setting | Docker Desktop default | `vm.overcommit_memory = 1` on the host, as Redis recommends for background saves |
| E-mail | Mailpit, keeps everything locally | An SMTP service with TLS and the group's domain (SPF, DKIM, DMARC); the worker refuses Mailpit, plain connections and development addresses |
| Backups | Logical dumps to a local volume (`scripts/db-backup.sh`) | pgBackRest to encrypted off-site storage, the write-ahead log at least every minute, documents copied every 5 minutes (M8.5, ADR 0035) |
| Object store | One Garage node, `replication_factor = 1`, secret files readable (`allow_world_readable_secrets`) | One unprivileged Garage node with frequent off-site copies (M8.5), its secret files `0444` inside the root-only secrets directory; three nodes with `replication_factor = 3` as the platform grows; encrypted disks; or any S3-compatible service in the EU (`STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET`) |

## Availability limits of the initial topology

One PostgreSQL and one Redis instance on one host is a single point of failure: a host outage stops the platform until it is restored from backup. It is a reasonable start for three schools if the recovery targets above are accepted. The growth path:

1. PostgreSQL streaming replica on a second host (`wal_level = replica` is already set) with managed failover (Patroni) or a managed PostgreSQL service with high availability.
2. Redis replica with Sentinel, or a managed Redis-compatible service.
3. Application instances (API, worker) scale horizontally behind the gateway; they keep no local state.
4. Reporting moves to a read replica once report queries affect daily work.

## Monitoring checklist (to implement with the application)

- PostgreSQL: connections per role, replication lag, longest transaction, lock waits (logged), `pg_stat_statements` top queries, autovacuum, disk usage, backup age, last successful restore check.
- Redis: memory against `maxmemory` (with `noeviction`, a full Redis rejects writes), AOF rewrite status, connected clients, queue depths and failed jobs.
- Audit log partitions: `audit.ensure_partitions()` must run monthly (worker job); alert if fewer than two future partitions exist.
- Data subject requests approaching `due_at`.
