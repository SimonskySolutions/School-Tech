# 0031 Notifications by e-mail

Date: 2026-11-01 · Status: Accepted

## Context

Several steps have waited for messages: the parent's confirmation when an order is paid (M2.5), approvals and tasks waiting for someone (M6), reminders of what is due. The e-mail service for production is to be decided later (2026-11-01), so nothing may depend on one provider's API. Messages go to parents and staff, and a message is the easiest place for personal data to leak: forwarded, printed, kept in mailboxes the group does not control.

Checked on 2026-11-01 for development and sending:

| Need | Option | Licence | State | Verdict |
| --- | --- | --- | --- | --- |
| A local mailbox for development and tests | Mailpit (`axllent/mailpit`) | MIT | v1.33.0 (2026-10-31), v1.31.6 (2026-10-15), actively maintained; SMTP server, web inbox and a JSON API | **Chosen**, v1.31.6 |
| | MailHog | MIT | No release since 2020 | Rejected: unmaintained |
| Sending from Node.js | Nodemailer | MIT-0 | 10.3.1 (2026-10-29), 10.1.7 (2026-10-18); no dependencies, own types | **Chosen**, 10.1.7 |

## Decision

**Standard SMTP, any provider.** The worker sends over SMTP with STARTTLS or implicit TLS, configured by `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER` and `SMTP_PASSWORD_FILE`, from `MAIL_FROM`. Any EU provider, or the group's own mail server, fits without code changes. In development the worker sends to Mailpit, which keeps everything locally and delivers nothing. Production refuses to start with the development mailbox, without TLS, or with a sender address on a development domain.

**Queued in the database, sent by the worker.** Something that should tell someone (for example the `commerce.order.paid` event) puts a message in `notify.message`: who it is for, its kind, its parameters, and a key that makes it once per thing (`order:<id>`). A second attempt to queue the same message does nothing. The worker claims due messages with a lease (`FOR UPDATE SKIP LOCKED`), so two workers never send the same one at once. It renders and sends each message, then marks it sent. A failure is retried after 1, 5 and 30 minutes, then 2 and 6 hours; after six attempts the message is marked failed and stays in the table to be seen, never dropped. The recipient's address is read when the message is sent, so a corrected address is used.

**Once, as far as e-mail allows.** If a worker stops after the mail service has accepted a message but before marking it sent, the lease runs out and the message is sent again. Every message carries the same `Message-ID` on each attempt, so mailboxes can recognise the repeat. A duplicate can only happen after a crash at that moment, and a message is never lost.

**Nothing sensitive in a message.** Templates are code, one per kind, in plain text. They name the recipient and say what happened, such as an order number, an amount or a document's title, and link to the portal page, where access is checked as for any visit. They never contain health, dietary or assessment data, documents, or links that work without signing in. The parameters stored with a message are the template's own, checked by the template before queuing. Each message also carries an HTML part (added with the visual design, docs/design.md), made from the same text by `notifications/email-html.ts`: the same words, the portal link as a button, nothing else added.

**People choose, except for what they must know.** Each kind is essential (payment confirmations, account and security messages) or not. A person may turn off any non-essential kind for themselves (`notify.preference`); a message of a kind they turned off is recorded as skipped and not sent.

**Retention.** Sent and skipped messages keep their parameters for 90 days, then only the kind, recipient, status and times remain (the worker's daily purge), as the audit of what was sent.

## Consequences

- The production provider still needs its domain set up: SPF, DKIM and DMARC records for the sender domain (`docs/operations.md`).
- SMS and Viber are not built; they would be further transports behind the same queue once a provider is chosen.
- Keycloak's own e-mails (setting a password) are configured in Keycloak with the same SMTP settings when production is set up; they do not go through this queue.
- Messages are in English, as the rest of the interface for now.
- M7.2 adds messages for approvals, tasks, replies to families, consent asked again and invitations to apply. Each is noted by a trigger as an outbox event with identifiers only, and the worker asks one `notify.on_*` function who is told, so who receives what is decided in the database next to the access rules it follows.
