# 0006 Personal data protection in the data layer

Date: 2026-10-29 · Status: Accepted

## Context

The platform processes personal data of children, parents and staff, including special-category (health) data such as allergies and medical diets. GDPR obligations that the data layer must support: data minimisation and storage limitation (Art. 5), security of processing (Art. 32), data subject rights (Art. 15–21, answered within one month, Art. 12(3)), records of processing (Art. 30), special-category data (Art. 9) and consent records (Art. 7).

This record describes technical measures. It does not make the platform compliant on its own: lawful bases, retention periods and the record of processing activities must be set and approved by the network's data protection officer (DPO), and a data protection impact assessment (DPIA) should be completed before production.

## Decision

**Minimisation and segregation**
- Health and dietary data live in schema `sensitive`, separate from operational data, with their own permission (`sensitive.dietary.read`) and an access log written by the API for every read.
- Redis holds no personal data (ADR 0002). Outbox and job payloads carry identifiers only.
- Webhook payloads from payment providers are kept for 90 days by default, then reduced to their identifiers.

**Records the DPO controls**
- `privacy.processing_purpose`: each purpose, its lawful basis, and whether it involves special-category data.
- `privacy.retention_policy`: how long each kind of record is kept and what happens after (delete, pseudonymise, archive). Nothing is deleted automatically until the DPO approves a policy.
- `privacy.consent_record`: who gave or withdrew consent for which purpose, for whom (a guardian for a child), when, and for which text version.
- `privacy.data_subject_request`: access, rectification, erasure, restriction, portability and objection requests, with a due date one month after receipt.

**Erasure without breaking legal records**
- `privacy.pseudonymise_person()` replaces names and contact details with a token, disables login, and keeps financial records that accounting law requires. Only the worker can run it, after a request is approved.

**Logs and audit**
- PostgreSQL logs never contain query parameter values (`log_parameter_max_length = 0`, also on error and in `auto_explain`), so personal data does not leak into server logs.
- `audit.change_log` records who changed what. Columns marked sensitive are recorded as changed but their values are redacted. The table is append-only for application roles and partitioned by month, so old partitions can be dropped under a retention policy.

**Security**
- Least-privilege roles (ADR 0004) and RLS (ADR 0005); SCRAM-SHA-256 passwords; no remote superuser.
- Data checksums on; production requires TLS for every database and Redis connection and encrypted storage (see `docs/operations.md`).
- Backups are personal data: they are written to a Docker volume, never to the repository or to a cloud-synced folder such as OneDrive, and production backups are encrypted.
- Development and test use synthetic data only.

## Consequences

- Retention periods are blank until approved. Bulgarian accounting law sets minimum retention for accounting records; the accountants and DPO must confirm the periods before the retention job is switched on.
- The access log for sensitive reads is an application responsibility (milestone with the API); the table exists now.
