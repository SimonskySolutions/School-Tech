# 0018 Real domains for school websites

Date: 2026-10-30 · Status: Accepted

## Context

Schools want their websites on their own domains (for example `www.school-d.bg`). The production gateway gets HTTPS certificates on demand, asking the API first (ADR 0015), and the web app serves a host only if `org.resolve_hostname` knows it (ADR 0011, 0017). Both accept only **verified** domains of **live** websites. Something must decide, safely, when a domain is verified: if anyone could mark a domain verified, they could make the gateway request certificates for names we do not own, or show a school's website on someone else's domain.

## Decision

- **Proof by a DNS record.** An administrator adds a domain to a school's website. It is stored as `pending` with a random 24-byte token, and the set-up page shows one TXT record to create: name `_pythagoras-verify.<domain>`, value `pythagoras-site-verification=<token>`. Whoever can create that record controls the domain's DNS. A record split into several strings counts as one.
- **Only the worker verifies.** Every minute the maintenance job `org.verify-domains` asks DNS for pending domains not checked in the last five minutes, outside any transaction, and marks a domain `verified` only when the record with its own token is there. The API cannot set `verified` on a real domain: its row-level security allows that only for `local_development` names, which the database allows only under `.localhost` and `.test`. "Check again now" only clears the last check time, so the next run looks at once.
- **Giving up.** A domain still pending after 14 days becomes `failed`; "check again" puts it back to `pending`.
- **Daily re-check.** A verified domain is checked again every 24 hours. If its record is missing, the domain keeps working and `missing_since` is set (migration `20261103090000`); the set-up page warns, with the date it will stop and the record to put back. If the record is still missing after a 3-day grace period, the domain becomes `failed`: no longer routed or certified, and `org.domain.lost` goes to the outbox. A record found again in time clears the warning; after a failure, "check again" and the record restore it. The grace period lets a DNS hiccup or a change of DNS provider pass without taking a website down.
- **Names.** Domains are lower-cased; development, reserved and internal names (`.localhost`, `.test`, `.local`, `.internal`, `.invalid`, `.example`) are refused, since the platform creates development addresses itself.
- **Routing follows verification.** Nothing else changes: once verified, the domain is answered by `org.resolve_hostname`, so the web app serves the website on it and `/internal/tls/allowed` lets the gateway obtain its certificate, provided the website is live.
- **Pointing the domain at us** (an A/AAAA or CNAME record to the gateway) is the school's other DNS step; it is in `docs/operations.md`. The TXT record proves control; the address record makes the domain reach us.

## Consequences

- No certificate is requested and no page served for a domain before its owner has proved control.
- DNS verification is tested with a stand-in resolver, because test domains do not exist; real DNS is used in development and production. A first real domain must be checked by hand before go-live.
- Not built yet: choosing which domain is primary, and the HTTP-token method, which the database already allows.
