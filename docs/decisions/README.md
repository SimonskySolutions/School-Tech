# Architecture decision records

Each record states one decision, why it was made, and what it costs. A record is never rewritten after it is accepted: a changed decision gets a new record that supersedes the old one.

| No. | Decision | Status |
| --- | --- | --- |
| [0001](0001-postgresql-version-and-image.md) | PostgreSQL 18.6 on the official Debian image | Accepted |
| [0002](0002-redis-for-queues.md) | Redis 8.10 as a queue store, separate from caching | Accepted |
| [0003](0003-sql-migrations-with-dbmate.md) | Plain SQL migrations applied with dbmate | Accepted |
| [0004](0004-database-roles.md) | Least-privilege database roles | Accepted |
| [0005](0005-row-level-security.md) | Person-context row-level security | Accepted |
| [0006](0006-personal-data-in-the-database.md) | Personal data protection in the data layer | Accepted |
| [0007](0007-money-time-identifiers.md) | Money, time and identifiers | Accepted |
| [0008](0008-one-order-per-billing-entity.md) | One order and one checkout per billing entity | Accepted |
| [0009](0009-keycloak-identity.md) | Keycloak as the identity provider | Accepted |
| [0010](0010-payments-before-stripe.md) | Payments built for Stripe, run on a development provider until it is set up | Accepted |
| [0011](0011-development-domains.md) | Development domains under .localhost | Accepted |
| [0012](0012-toolchain.md) | Toolchain and workspace | Accepted |
| [0013](0013-api-data-access-and-auth.md) | API data access and authentication | Accepted |
| [0014](0014-web-sessions.md) | Web sign-in and sessions | Accepted |
| [0015](0015-gateway-images-ci.md) | Gateway, production images and continuous integration | Accepted |
| [0016](0016-accounts-for-new-people.md) | Sign-in accounts for people an administrator registers | Accepted |
| [0017](0017-websites-with-payload.md) | School websites with Payload CMS | Accepted |
| [0018](0018-real-domains.md) | Real domains for school websites | Accepted |
| [0019](0019-cms-sign-in-with-keycloak.md) | CMS editors sign in with Keycloak | Accepted |
| [0020](0020-menus-allergens-dietary-verification.md) | Lunch menus, allergens and verified dietary needs | Accepted |
| [0021](0021-activity-eligibility-and-attendance.md) | Activity eligibility and attendance | Accepted |
| [0022](0022-individual-lessons.md) | Individual lessons: teachers, rooms, slots and packages | Accepted |
| [0023](0023-trips-and-consent.md) | Trips and guardian consent | Accepted |
| [0024](0024-transport-routes-and-seats.md) | Transport: routes, stops and seats for a term | Accepted |
| [0025](0025-uniforms-and-stock.md) | Uniforms: variants, prices and stock | Accepted |
| [0026](0026-admissions-and-prospective-families.md) | Admissions: prospective families' data | Accepted |
