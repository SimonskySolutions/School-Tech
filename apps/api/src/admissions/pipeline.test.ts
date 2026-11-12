import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_RULES, intakeFromRow } from './pipeline';

const row = {
  school_id: 'b1000000-0000-7000-8000-00000000000a' as never,
  school_name: 'School A',
  intake_id: 'db000000-0000-7000-8000-0000000000a1',
  school_year: '2027/28',
  grade: '1',
  places: 5,
  intake_status: 'open' as const,
  from_inquiry: 1,
  submitted: 2,
  under_review: 1,
  waitlisted: 3,
  offered: 1,
  accepted: 1,
  enrolled: 2,
  declined: 1,
  expired: 0,
  rejected: 1,
  withdrawn: 1,
};

describe('the admissions pipeline', () => {
  it('counts free places as those not offered, accepted or enrolled', () => {
    expect(intakeFromRow(row)).toMatchObject({
      free: 1,
      fromInquiry: 1,
      counts: { waitlisted: 3, enrolled: 2 },
    });
    expect(intakeFromRow({ ...row, offered: 4 }).free).toBe(0);
  });

  it('follows up inquiries after three days, applications after a week, offers ending within three days', () => {
    expect(FOLLOW_UP_RULES).toEqual({ inquiryDays: 3, applicationDays: 7, offerEndsWithinDays: 3 });
  });
});
