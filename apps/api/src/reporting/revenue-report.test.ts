import { type SchoolId } from '@pythagoras/shared';
import { describe, expect, it } from 'vitest';
import { buildRevenueReport, type RevenueRow } from './revenue-report';

const A = { id: 'school-a' as SchoolId, name: 'School A' };
const C = { id: 'school-c' as SchoolId, name: 'School C' };
const range = { from: '2026-10-01', to: '2026-10-31' };

const revenue = (school: string, mode: 'live' | 'test', received: number, credited = 0): RevenueRow => ({
  school_id: school,
  currency: 'EUR',
  payment_mode: mode,
  received_minor: String(received),
  paid_by_credit_minor: '0',
  refunded_minor: '0',
  credited_minor: String(credited),
  net_minor: String(received - credited),
});

describe('buildRevenueReport', () => {
  it('keeps test-mode money apart from live revenue, per school and in the totals', () => {
    const report = buildRevenueReport(
      range,
      [A, C],
      [
        revenue('school-a', 'test', 7400),
        revenue('school-a', 'live', 1000),
        revenue('school-c', 'test', 500, 500),
      ],
      [],
      [],
    );
    expect(report.schools.map((row) => [row.school.name, row.live.netMinor, row.test.netMinor])).toEqual([
      ['School A', 1000, 7400],
      ['School C', 0, 0],
    ]);
    expect(report.schools[1]!.test).toMatchObject({ receivedMinor: 500, creditedMinor: 500 });
    expect(report.totals).toEqual([
      {
        currency: 'EUR',
        live: {
          receivedMinor: 1000,
          paidByCreditMinor: 0,
          refundedMinor: 0,
          creditedMinor: 0,
          netMinor: 1000,
        },
        test: {
          receivedMinor: 7900,
          paidByCreditMinor: 0,
          refundedMinor: 0,
          creditedMinor: 500,
          netMinor: 7400,
        },
      },
    ]);
  });

  it('adds open balances and credit owed, and lists schools that have no money yet', () => {
    const report = buildRevenueReport(
      range,
      [A, C],
      [],
      [
        {
          school_id: 'school-a',
          currency: 'EUR',
          open_invoices: '1',
          outstanding_minor: '45000',
          overdue_minor: '45000',
          checkout_in_progress_minor: '450',
        },
      ],
      [{ school_id: 'school-a', currency: 'EUR', payment_mode: 'test', remaining_minor: '450' }],
    );
    expect(report.schools[0]).toMatchObject({
      openInvoices: 1,
      outstandingMinor: 45000,
      overdueMinor: 45000,
      checkoutInProgressMinor: 450,
      creditOwed: { liveMinor: 0, testMinor: 450 },
    });
    expect(report.schools[1]).toMatchObject({ school: C, currency: 'EUR', outstandingMinor: 0 });
  });

  it('ignores rows for schools the reader may not report on', () => {
    const report = buildRevenueReport(range, [A], [revenue('school-c', 'live', 999)], [], []);
    expect(report.schools.map((row) => row.school.name)).toEqual(['School A']);
    expect(report.totals[0]!.live.netMinor).toBe(0);
  });

  it('refuses amounts that would lose precision', () => {
    expect(() =>
      buildRevenueReport(
        range,
        [A],
        [revenue('school-a', 'live', 0)].map((row) => ({ ...row, net_minor: '9007199254740993' })),
        [],
        [],
      ),
    ).toThrow('out of range');
  });
});
