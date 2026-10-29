# Integration register

Tracks every external dependency separately from implemented functionality. "Implemented" here means only what exists in this repository; nothing below has been validated against a real external system yet.

| System | Purpose | Contract known? | In the repository | External validation | Next step |
| --- | --- | --- | --- | --- | --- |
| Stripe (test mode) | Hosted checkout, payment events, refunds | Public API and webhook signing are documented | Adapter built: Checkout Session creation with an idempotency key, webhook signature and mode check, mapping of `checkout.session.*` events; unit-tested against the documented formats. Not built: payment retrieval, refunds, session expiry | None. **No account yet, by decision** (ADR 0010): built, not validated | Create a test-mode account, configure it (operations: Payments), run one real test payment and resend its webhook from the Stripe CLI |
| Development payment provider | Stand-in for Stripe until it is set up | Our own: HMAC-signed checkout tokens and events in Stripe's signature scheme | `apps/api/src/payments/development-provider.ts`; test checkout page under `/dev-payments/` (404 with Stripe or in production) | Exercised by the integration and end-to-end suites | Keep for development; never configured in production |
| Keycloak 26.8.1 | Single sign-on for staff and parents | Standard OpenID Connect; self-hosted, so fully under our control | Service, own database, development realm, users linked to seeded people; `scripts/identity-test.sh` | **Validated locally** (25 checks): realm security settings, real tokens, subject-to-person link, RLS per person | M1.3: token verification in the API. M8: production realm and staff MFA |
| Shkolo | E-diary: students, classes, grades, attendance | **Unknown.** No public API documentation found | `integration.external_reference` only | None | Ask Shkolo for an API or export contract before any dependent feature |
| Bulgarian accounting software | Journal entries, invoices, payments per entity | **Unknown.** No public API found for Ajur, Microinvest or Plus Minus | Allocations ledger per entity and school ready for export | None | Ask the accountants which software and import format they use |
| Statutory payroll and official reporting (НАП, НОИ, НЕИСПУО) | Payroll declarations, school reporting | Not in scope of the platform; stays in accounting/payroll software and Shkolo | Nothing | n/a | Confirm boundaries with the accountants and school administration |
| Qualified e-signature | Signing contracts and consent forms | Depends on the chosen Bulgarian trust service provider | Nothing | None | Choose a provider in the documents milestone |
| E-mail / SMS / Viber | Notifications | Standard provider APIs | Outbox table | None | Choose providers with the notifications milestone |
| Payload CMS | School websites | Payload's own API | `org.website.cms_tenant_key` | None | Websites milestone |

Until a contract is confirmed, any adapter for these systems must be a clearly named development adapter and must not be described as an integration.
