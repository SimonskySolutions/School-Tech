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
