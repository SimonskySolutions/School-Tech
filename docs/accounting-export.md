# Accounting export

The ledger of one company for a period, entry by entry, for the group's accountants (M7.4). **This is the platform's own layout, not yet an import format.** The accountants' software and its import format are to be confirmed (decided 2026-11-01: later). Once they are known, a matching export is added beside this one. This layout stays, as the platform's record of what was exported.

## Who and how

- Only **group finance** (`accounting.export`) exports, on the "Accounting export" page (`/accounting`), linked from the home page. Choose the company and the period, from one day to one year. The page shows the totals; "Download the entries (CSV)" gives the file.
- Every export and every summary shown is written to the access log (`audit.access_log`, action `export`, resource `commerce.accounting_entries`, with the number of entries).
- The file names no payer, child, address or e-mail. Each entry carries its order number, which those allowed to look can follow in the platform.

## The file

- CSV as in RFC 4180: comma-separated, a header line, lines ending in CRLF, UTF-8 **without** a byte-order mark. A text field is quoted when it contains a comma, a double quote or a line break; quotes inside are doubled.
- A text field that begins with `=`, `+`, `-`, `@`, a tab or a carriage return is written with a leading `'`, so a spreadsheet never runs it as a formula. Amounts are not text and are written as they are.
- One line per ledger entry (`commerce.payment_allocation`), oldest first. An entry belongs to the day it was booked in the school's time zone.

| Column | Meaning |
| --- | --- |
| `date` | The day the entry was booked, `YYYY-MM-DD`, the school's local time |
| `entry` | `payment` (money received), `credit_applied` (paid with account credit), `refund` (money returned), `credit_issued` (money turned into account credit) |
| `mode` | `live` or `test`. **Book only `live`**: `test` entries come from test payments (the development provider, Stripe test mode) and are never real money |
| `order` | The order number, `PY-` and eight digits |
| `school_code`, `school` | The school the money belongs to |
| `service` | The service's code (`lunch`, `chess`, `tuition`, …) |
| `description` | The order line as the family saw it (the offering, the day or term) |
| `service_date` | The day of the service, when it is a single day |
| `currency` | ISO 4217, for example `EUR` |
| `amount` | Signed as in the ledger, with a full stop and the currency's decimals: payments and credit applied are positive, refunds and credit issued are negative |
| `payment_provider`, `payment_reference` | For payments and refunds, the provider and its payment identifier, to reconcile with the provider's statement |
| `refund_id`, `credit_id` | The platform's identifiers of the refund or the account credit, when the entry is one |
| `entry_id` | The entry's own identifier, unique, for de-duplicating a repeated import |

## Totals

The sum of all entries for a currency and mode is the period's **net**: received + paid by credit − refunded − credited. It equals the net of the revenue report (`reporting.school_revenue_daily`) for the same company, days and mode; the database test checks this.
