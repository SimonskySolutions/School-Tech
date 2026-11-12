# 0011 Development domains under .localhost

Date: 2026-10-29 · Status: Accepted

## Decision

School websites and the portal use host names under `pythagoras.localhost` in development (for example `school-a.pythagoras.localhost`). Browsers resolve `*.localhost` to the local machine without editing the hosts file, so every developer machine works the same way and no system setting is changed.

The database already allows the `local_development` verification shortcut only for `.localhost` and `.test` names (`org.website_domain`). Real domains are verified by the worker through DNS, and need DNS records and TLS certificates; the requirements go in `docs/operations.md` with the websites milestone.
