# 0032 Integrations awaiting contracts

Date: 2026-11-02 · Status: Accepted

## Context

The brief asks that, for Shkolo, Bulgarian accounting, statutory payroll, official reporting and electronic signatures, the supported integration contract is established before any dependent behaviour is built, and that external validation is tracked apart from what is implemented. On 2026-11-01 it was decided to settle these later: there is no Shkolo contract yet, the accountants' software is not confirmed, and no e-signature provider is chosen. The accounting export (M7.4) is the platform's own documented layout, labelled as not yet an import format. This record sets the boundaries for the rest, so that nothing in the platform pretends otherwise in the meantime.

## Decision

**Nothing is built for them, not even a development adapter.** A development adapter would have to invent a format or an API that nobody has confirmed, and could later be taken for the real thing. For the payment provider there is a development stand-in because Stripe's contract is public; for these systems there is none. An architecture test fails if application code, seeds or pages name Shkolo, a trust service provider, НАП, НОИ or НЕИСПУО. The integration register says, for each, what is needed and what was decided.

**Shkolo (e-diary).** Shkolo keeps classes, timetables, grades, attendance and the school's statutory records. The platform keeps none of that: it has enrolments with a class label for its own services, and nothing more. Before anything is built, three things are needed: Shkolo's API or export documentation and its terms; a data-processing agreement covering what flows in each direction (for example enrolments and guardians from the platform, classes from Shkolo); and the schools' agreement on which system is authoritative for what. `integration.external_reference` already allows `shkolo` identifiers, so records can be matched once a contract exists; it holds none.

**Qualified electronic signatures.** Approvals (M6.5) and family consents (M6.6) are records of a decision by a signed-in person: who, what, when and the exact version. They are not qualified electronic signatures in the sense of eIDAS, and the platform never calls them that. Where a qualified signature is needed, for example on an employment contract, it is signed outside the platform and the signed file is filed as a document (M6.4). A Bulgarian qualified trust service provider is to be chosen first (Evrotrust, B-Trust by Borica, InfoNotary and others offer remote signing), with its contract, API and costs, before signing inside the platform is considered.

**Statutory payroll and official reporting.** Payroll declarations (НАП, НОИ) and official school reporting (НЕИСПУО) stay in the payroll and accounting software and in the schools' own systems. The platform keeps no payroll data (ADR 0028) and reports nothing to authorities. The boundary is to be confirmed with the accountants and the school administrations; until then, nothing in the platform reports to these bodies.

**SMS and Viber.** These are optional, with no provider chosen. If they are wanted, they would be a further transport behind the notification queue (ADR 0031).

## Consequences

- Each of these is recorded in `docs/integration-register.md` as not built, with its next step. When a contract arrives, the integration gets its own ADR and step: contract tests first, against recorded examples from the provider, then the adapter.
- People keep using Shkolo, the payroll software and the authorities' own portals as they do today; the platform does not duplicate their records.
- The architecture test needs a deliberate change, recorded in the integration's own ADR, before any of these names can appear in code.
