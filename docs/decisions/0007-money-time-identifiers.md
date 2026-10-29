# 0007 Money, time and identifiers

Date: 2026-10-29 · Status: Accepted

## Decision

**Money**
- Amounts are `bigint` in minor units (euro cents) with a `currency` column (`char(3)`, ISO 4217, default `EUR`). No floating point, no `money` type.
- VAT rates are stored as basis points (`2000` = 20.00 %), with the rate copied onto each order line.
- Bulgaria adopted the euro on 2026-01-01. Historical amounts in leva, if imported, keep the original amount and currency in an import record alongside the converted euro amount (fixed rate 1 EUR = 1.95583 BGN).

**Prices and terms**
- A price is an immutable `catalog.price_version` with a validity period. Changing a price means closing the current version and adding a new one; overlapping versions are rejected by an exclusion constraint.
- An order line copies the unit price, VAT rate, description and the ids of the price and policy versions at the moment of ordering. Later price changes never alter existing orders.

**Time**
- Instants are `timestamptz`, stored in UTC; the database server and sessions run in UTC.
- Each school has an IANA time zone (default `Europe/Sofia`). A service date (a lunch day, a trip day) is a `date` in the school's time zone; cutoffs are stored as instants computed from that zone, so daylight-saving changes are handled once, in one place.

**Identifiers**
- Primary keys are UUID version 7 (`uuidv7()`, built into PostgreSQL 18): globally unique, safe to expose, and time-ordered for index locality.
- Human-facing numbers (order numbers) are separate columns.

**State**
- Orders, payments, bookings and refunds each have their own state column, constrained to known values. Allowed transitions are listed in `meta.state_transition` and enforced by triggers, so an out-of-order payment event cannot move a paid order back to pending.
