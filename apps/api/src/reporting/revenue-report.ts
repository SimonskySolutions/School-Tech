import { DEFAULT_CURRENCY, type RevenueFigures, type RevenueReport, type SchoolId } from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Revenue per school from the reporting views (ADR 0007, 0010). The views run
// with the reader's rights, so a principal gets their own school and the CEO
// every school; this module only reads and adds up. Sums arrive as strings
// (bigint) and are converted once, here.

export type PaymentMode = 'live' | 'test';

export interface SchoolRow {
  id: SchoolId;
  name: string;
}

export interface RevenueRow {
  school_id: string;
  currency: string;
  payment_mode: PaymentMode;
  received_minor: string;
  paid_by_credit_minor: string;
  refunded_minor: string;
  credited_minor: string;
  net_minor: string;
}

export interface BalanceRow {
  school_id: string;
  currency: string;
  open_invoices: string;
  outstanding_minor: string;
  overdue_minor: string;
  checkout_in_progress_minor: string;
}

export interface CreditRow {
  school_id: string;
  currency: string;
  payment_mode: PaymentMode;
  remaining_minor: string;
}

const zero = (): RevenueFigures => ({
  receivedMinor: 0,
  paidByCreditMinor: 0,
  refundedMinor: 0,
  creditedMinor: 0,
  netMinor: 0,
});

function add(into: RevenueFigures, from: RevenueFigures): void {
  into.receivedMinor += from.receivedMinor;
  into.paidByCreditMinor += from.paidByCreditMinor;
  into.refundedMinor += from.refundedMinor;
  into.creditedMinor += from.creditedMinor;
  into.netMinor += from.netMinor;
}

const toInt = (value: string): number => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`amount out of range: ${value}`);
  return number;
};

/** Pure: one row per school and currency, every school the reader may see even without money. */
export function buildRevenueReport(
  range: { from: string; to: string },
  schools: readonly SchoolRow[],
  revenue: readonly RevenueRow[],
  balances: readonly BalanceRow[],
  credits: readonly CreditRow[],
): RevenueReport {
  type Entry = RevenueReport['schools'][number];
  const entries = new Map<string, Entry>();
  const entry = (school: SchoolRow, currency: string): Entry => {
    const key = `${school.id}:${currency}`;
    let found = entries.get(key);
    if (!found) {
      found = {
        school: { id: school.id, name: school.name },
        currency,
        live: zero(),
        test: zero(),
        openInvoices: 0,
        outstandingMinor: 0,
        overdueMinor: 0,
        checkoutInProgressMinor: 0,
        creditOwed: { liveMinor: 0, testMinor: 0 },
      };
      entries.set(key, found);
    }
    return found;
  };
  const byId = new Map(schools.map((school) => [school.id as string, school]));
  const schoolOf = (id: string) => byId.get(id);

  for (const row of revenue) {
    const school = schoolOf(row.school_id);
    if (!school) continue;
    add(entry(school, row.currency)[row.payment_mode], {
      receivedMinor: toInt(row.received_minor),
      paidByCreditMinor: toInt(row.paid_by_credit_minor),
      refundedMinor: toInt(row.refunded_minor),
      creditedMinor: toInt(row.credited_minor),
      netMinor: toInt(row.net_minor),
    });
  }
  for (const row of balances) {
    const school = schoolOf(row.school_id);
    if (!school) continue;
    const target = entry(school, row.currency);
    target.openInvoices += toInt(row.open_invoices);
    target.outstandingMinor += toInt(row.outstanding_minor);
    target.overdueMinor += toInt(row.overdue_minor);
    target.checkoutInProgressMinor += toInt(row.checkout_in_progress_minor);
  }
  for (const row of credits) {
    const school = schoolOf(row.school_id);
    if (!school) continue;
    const target = entry(school, row.currency).creditOwed;
    if (row.payment_mode === 'test') target.testMinor += toInt(row.remaining_minor);
    else target.liveMinor += toInt(row.remaining_minor);
  }
  // A school with no money yet still appears, in the platform's currency.
  for (const school of schools) {
    if (![...entries.values()].some((found) => found.school.id === school.id))
      entry(school, DEFAULT_CURRENCY);
  }

  const rows = [...entries.values()].sort(
    (a, b) => a.school.name.localeCompare(b.school.name) || a.currency.localeCompare(b.currency),
  );
  const totals = new Map<string, RevenueReport['totals'][number]>();
  for (const row of rows) {
    const total = totals.get(row.currency) ?? { currency: row.currency, live: zero(), test: zero() };
    add(total.live, row.live);
    add(total.test, row.test);
    totals.set(row.currency, total);
  }
  return { ...range, schools: rows, totals: [...totals.values()] };
}

/** Today and the first of this month where the group's schools are. */
export async function currentMonth(tx: PersonTransaction): Promise<{ from: string; to: string }> {
  const [row] = await tx.query<{ from: string; to: string }>(
    `SELECT to_char(date_trunc('month', today), 'YYYY-MM-DD') AS "from", to_char(today, 'YYYY-MM-DD') AS "to"
       FROM (SELECT coalesce(min((now() AT TIME ZONE time_zone)::date), current_date) AS today
               FROM org.school WHERE group_id = access.current_group_id()) t`,
  );
  return row!;
}

export async function loadRevenueReport(
  tx: PersonTransaction,
  range: { from: string; to: string },
): Promise<RevenueReport> {
  const schools = await tx.query<SchoolRow>(
    `SELECT id, name FROM org.school
      WHERE group_id = access.current_group_id() AND status <> 'archived'
        AND access.has_permission('reports.read', id)
      ORDER BY name`,
  );
  const revenue = await tx.query<RevenueRow>(
    `SELECT school_id, currency, payment_mode,
            sum(received_minor)::text AS received_minor, sum(paid_by_credit_minor)::text AS paid_by_credit_minor,
            sum(refunded_minor)::text AS refunded_minor, sum(credited_minor)::text AS credited_minor,
            sum(net_minor)::text AS net_minor
       FROM reporting.school_revenue_daily
      WHERE local_date BETWEEN $1::date AND $2::date
      GROUP BY school_id, currency, payment_mode`,
    [range.from, range.to],
  );
  const balances = await tx.query<BalanceRow>(
    `SELECT school_id, currency, sum(open_invoices)::text AS open_invoices,
            sum(outstanding_minor)::text AS outstanding_minor, sum(overdue_minor)::text AS overdue_minor,
            sum(checkout_in_progress_minor)::text AS checkout_in_progress_minor
       FROM reporting.outstanding_balance GROUP BY school_id, currency`,
  );
  const credits = await tx.query<CreditRow>(
    `SELECT l.school_id, c.currency,
            CASE WHEN EXISTS (SELECT 1 FROM commerce.payment p WHERE p.order_id = l.order_id AND p.provider_mode = 'test')
                 THEN 'test' ELSE 'live' END AS payment_mode,
            sum(c.remaining_amount_minor)::text AS remaining_minor
       FROM commerce.account_credit c JOIN commerce.order_line l ON l.id = c.source_order_line_id
      WHERE c.status = 'active' AND access.has_permission('reports.read', l.school_id)
      GROUP BY 1, 2, 3`,
  );
  return buildRevenueReport(range, schools, revenue, balances, credits);
}
