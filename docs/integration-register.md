# Integration register

Tracks every external dependency separately from implemented functionality. "Implemented" here means only what exists in this repository; nothing below has been validated against a real external system yet.

| System | Purpose | Contract known? | In the repository | External validation | Next step |
| --- | --- | --- | --- | --- | --- |
| Stripe (test mode) | Hosted checkout, payment events, refunds | Public API and webhook signing are documented | Database side only: payments, verified inbound events, idempotent storage, state machine | None | M2: test-mode account and keys from the network; webhook signature verification in the API |
| Keycloak | Single sign-on for staff and parents | Standard OpenID Connect | `people.login_identity`, `access.resolve_login()` | None | M1: decide Keycloak vs. Microsoft Entra ID / Google (depends on what the network already uses) |
| Shkolo | E-diary: students, classes, grades, attendance | **Unknown.** No public API documentation found | `integration.external_reference` only | None | Ask Shkolo for an API or export contract before any dependent feature |
| Bulgarian accounting software | Journal entries, invoices, payments per entity | **Unknown.** No public API found for Ajur, Microinvest or Plus Minus | Allocations ledger per entity and school ready for export | None | Ask the accountants which software and import format they use |
| Statutory payroll and official reporting (НАП, НОИ, НЕИСПУО) | Payroll declarations, school reporting | Not in scope of the platform; stays in accounting/payroll software and Shkolo | Nothing | n/a | Confirm boundaries with the accountants and school administration |
| Qualified e-signature | Signing contracts and consent forms | Depends on the chosen Bulgarian trust service provider | Nothing | None | Choose a provider in the documents milestone |
| E-mail / SMS / Viber | Notifications | Standard provider APIs | Outbox table | None | Choose providers with the notifications milestone |
| Payload CMS | School websites | Payload's own API | `org.website.cms_tenant_key` | None | Websites milestone |

Until a contract is confirmed, any adapter for these systems must be a clearly named development adapter and must not be described as an integration.
