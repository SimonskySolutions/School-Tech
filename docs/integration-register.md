# Integration register

Tracks every external dependency separately from implemented functionality. "Implemented" here means only what exists in this repository; nothing below has been validated against a real external system yet.

| System | Purpose | Contract known? | In the repository | External validation | Next step |
| --- | --- | --- | --- | --- | --- |
| Stripe (test mode) | Hosted checkout, payment events, refunds | Public API and webhook signing are documented | Database side only: payments, verified inbound events, idempotent storage, state machine | None. **No account yet, by decision** (ADR 0010) | M2: build the Stripe adapter disabled, plus a labelled development provider; enable when test-mode keys exist |
| Keycloak 26.8.1 | Single sign-on for staff and parents | Standard OpenID Connect; self-hosted, so fully under our control | Service, own database, development realm, users linked to seeded people; `scripts/identity-test.sh` | **Validated locally** (25 checks): realm security settings, real tokens, subject-to-person link, RLS per person | M1.3: token verification in the API. M8: production realm and staff MFA |
| Shkolo | E-diary: students, classes, grades, attendance | **Unknown.** No public API documentation found | `integration.external_reference` only | None | Ask Shkolo for an API or export contract before any dependent feature |
| Bulgarian accounting software | Journal entries, invoices, payments per entity | **Unknown.** No public API found for Ajur, Microinvest or Plus Minus | Allocations ledger per entity and school ready for export | None | Ask the accountants which software and import format they use |
| Statutory payroll and official reporting (НАП, НОИ, НЕИСПУО) | Payroll declarations, school reporting | Not in scope of the platform; stays in accounting/payroll software and Shkolo | Nothing | n/a | Confirm boundaries with the accountants and school administration |
| Qualified e-signature | Signing contracts and consent forms | Depends on the chosen Bulgarian trust service provider | Nothing | None | Choose a provider in the documents milestone |
| E-mail / SMS / Viber | Notifications | Standard provider APIs | Outbox table | None | Choose providers with the notifications milestone |
| Payload CMS | School websites | Payload's own API | `org.website.cms_tenant_key` | None | Websites milestone |

Until a contract is confirmed, any adapter for these systems must be a clearly named development adapter and must not be described as an integration.
