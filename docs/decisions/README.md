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
