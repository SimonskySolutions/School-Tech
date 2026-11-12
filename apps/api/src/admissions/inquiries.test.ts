import { describe, expect, it } from 'vitest';
import { closeSchema, inquirySchema, noteSchema } from './inquiries.controller';
import { formFromRows } from './inquiries.repository';

const SCHOOL = 'b1000000-0000-7000-8000-00000000000a';
const NOTICE = 'd9000000-0000-7000-8000-000000000001';
const valid = {
  host: 'School-A.pythagoras.localhost:53000',
  schoolId: SCHOOL,
  noticeId: NOTICE,
  parentName: ' Vera Test ',
  email: 'Vera@Example.test',
  newsConsent: false,
};

describe('the inquiry form', () => {
  it('accepts the allowed fields, trimming and lower-casing the host and address', () => {
    expect(inquirySchema.parse({ ...valid, birthYear: 2019, message: 'Grade 2?' })).toMatchObject({
      host: 'school-a.pythagoras.localhost',
      parentName: 'Vera Test',
      email: 'vera@example.test',
      birthYear: 2019,
    });
  });

  it('refuses anything beyond what the notice states, and malformed values', () => {
    expect(inquirySchema.safeParse({ ...valid, dateOfBirth: '2019-04-01' }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...valid, allergies: 'peanuts' }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...valid, email: 'no address' }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...valid, phone: 'call me' }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...valid, host: 'not a host' }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...valid, message: 'x'.repeat(2001) }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...valid, newsConsent: 'yes' }).success).toBe(false);
  });

  it('gives staff only their own kinds of note and known outcomes', () => {
    expect(noteSchema.safeParse({ kind: 'call', body: 'Called back' }).success).toBe(true);
    expect(noteSchema.safeParse({ kind: 'family_message', body: 'forged' }).success).toBe(false);
    expect(closeSchema.safeParse({ outcome: 'applied' }).success).toBe(true);
    expect(closeSchema.safeParse({ outcome: 'lost' }).success).toBe(false);
  });

  it('builds the form from the database rows, or none without them', () => {
    expect(formFromRows([])).toBeNull();
    const row = {
      notice_id: NOTICE,
      notice_version: 2,
      notice_text: 'Notice',
      news_consent_text: 'News',
    };
    expect(
      formFromRows([
        { ...row, school_id: SCHOOL, school_name: 'School A' },
        { ...row, school_id: 'b1000000-0000-7000-8000-00000000000b', school_name: 'School B' },
      ]),
    ).toEqual({
      schools: [
        { id: SCHOOL, name: 'School A' },
        { id: 'b1000000-0000-7000-8000-00000000000b', name: 'School B' },
      ],
      notice: { id: NOTICE, version: 2, text: 'Notice', newsConsentText: 'News' },
    });
  });
});
