// The accounting export page (M7.4): the period asked for, or last month.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ENTRY_LABELS: Record<string, string> = {
  payment: 'Payments received',
  credit_applied: 'Paid with account credit',
  refund: 'Refunds',
  credit_issued: 'Credit issued',
};

/** The first and last day of the month before the given day. */
export function lastMonth(today: string): { from: string; to: string } {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(year, month - 2, 1));
  const last = new Date(Date.UTC(year, month - 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** The company and period from the query, falling back to the first company and last month. */
export function readPeriod(
  query: Record<string, string | string[] | undefined>,
  companies: readonly { id: string }[],
  today: string,
): { companyId: string; from: string; to: string } | null {
  const value = (name: string) => {
    const found = query[name];
    return typeof found === 'string' ? found : '';
  };
  const companyId = UUID.test(value('companyId')) ? value('companyId') : companies[0]?.id;
  if (!companyId) return null;
  const fallback = lastMonth(today);
  return {
    companyId,
    from: DAY.test(value('from')) ? value('from') : fallback.from,
    to: DAY.test(value('to')) ? value('to') : fallback.to,
  };
}
