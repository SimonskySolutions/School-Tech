import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import { closeBody, inquiryBody, isTrapped, noteBody, sentNotice } from './admissions';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const SCHOOL = 'b1000000-0000-7000-8000-00000000000a';
const NOTICE = 'd9000000-0000-7000-8000-000000000001';
const filled = {
  school_id: SCHOOL,
  notice_id: NOTICE,
  parent_name: ' Vera Test ',
  email: 'Vera@Example.test',
  notice_read: 'yes',
};

describe('the website inquiry form', () => {
  it('sends only what was filled in, and the news consent only when ticked', () => {
    expect(inquiryBody(form(filled), 'school-a.pythagoras.localhost')).toEqual({
      host: 'school-a.pythagoras.localhost',
      schoolId: SCHOOL,
      noticeId: NOTICE,
      parentName: 'Vera Test',
      email: 'vera@example.test',
      newsConsent: false,
    });
    expect(
      inquiryBody(
        form({ ...filled, birth_year: '2019', message: 'Grade 2?', news_consent: 'yes' }),
        'h.test',
      ),
    ).toMatchObject({ birthYear: 2019, message: 'Grade 2?', newsConsent: true });
  });

  it('asks for a name, an address, a confirmed notice and sensible values', () => {
    const problem = (fields: Record<string, string>) => () =>
      inquiryBody(form({ ...filled, ...fields }), 'h.test');
    expect(problem({ parent_name: '' })).toThrow(FormProblem);
    expect(problem({ email: 'no address' })).toThrow(FormProblem);
    expect(problem({ notice_read: '' })).toThrow('privacy notice');
    expect(problem({ birth_year: '19' })).toThrow(FormProblem);
    expect(problem({ phone: 'call me' })).toThrow(FormProblem);
    expect(problem({ school_id: 'school-a' })).toThrow(FormProblem);
  });

  it('spots the hidden field bots fill in', () => {
    expect(isTrapped(form(filled))).toBe(false);
    expect(isTrapped(form({ ...filled, website: 'http://spam.example' }))).toBe(true);
  });

  it('answers the same whatever happened to the address', () => {
    expect(sentNotice(202)).toBe('sent');
    expect(sentNotice(409)).toBe('notice-changed');
    expect(sentNotice(429)).toBe('busy');
    expect(sentNotice(500)).toBe('failed');
    expect(sentNotice(0)).toBe('failed');
  });
});

describe('staff forms on an inquiry', () => {
  it('takes known note kinds and outcomes only', () => {
    expect(noteBody(form({ kind: 'call', body: 'Called back' }))).toEqual({
      kind: 'call',
      body: 'Called back',
    });
    expect(() => noteBody(form({ kind: 'family_message', body: 'x' }))).toThrow(FormProblem);
    expect(() => noteBody(form({ kind: 'note', body: '' }))).toThrow(FormProblem);
    expect(closeBody(form({ outcome: 'not_interested' }))).toEqual({ outcome: 'not_interested' });
    expect(() => closeBody(form({ outcome: 'lost' }))).toThrow(FormProblem);
  });
});
