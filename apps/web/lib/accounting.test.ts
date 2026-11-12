import { describe, expect, it } from 'vitest';
import { lastMonth, readPeriod } from './accounting';

const COMPANY = 'a2000000-0000-7000-8000-000000000001';

describe('the accounting period', () => {
  it('is last month unless another is asked for', () => {
    expect(lastMonth('2026-11-01')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(lastMonth('2026-03-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(lastMonth('2027-01-05')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(readPeriod({}, [{ id: COMPANY }], '2026-11-01')).toEqual({
      companyId: COMPANY,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(
      readPeriod(
        { from: '2026-11-01', to: '2026-11-30', companyId: 'nonsense' },
        [{ id: COMPANY }],
        '2026-11-01',
      ),
    ).toEqual({ companyId: COMPANY, from: '2026-11-01', to: '2026-11-30' });
    expect(readPeriod({}, [], '2026-11-01')).toBeNull();
  });
});
