import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import {
  applicationBody,
  applicationNoteBody,
  isFinished,
  offerBody,
  closeBody,
  inquiryBody,
  intakeBody,
  inviteBody,
  isTrapped,
  noteBody,
  sentNotice,
  splitName,
} from './admissions';

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

describe('applications in the portal', () => {
  const INTAKE = 'db000000-0000-7000-8000-0000000000a1';
  const CHILD = 'c1000000-0000-7000-8000-000000000031';
  const base = { intake_id: INTAKE, notice_id: NOTICE, notice_read: 'yes' };

  it('sends one of the parent’s children by id, and nothing typed for a new child', () => {
    expect(
      applicationBody(form({ ...base, child: CHILD, child_given_name: 'Typed', message: 'Hi' })),
    ).toEqual({
      intakeId: INTAKE,
      noticeId: NOTICE,
      studentId: CHILD,
      message: 'Hi',
    });
  });

  it('needs a new child’s name and date of birth, and the notice confirmed', () => {
    const child = { child_given_name: 'Nia', child_family_name: 'Ivanova', child_birth_date: '2021-02-03' };
    expect(applicationBody(form({ ...base, child: 'new', ...child }))).toEqual({
      intakeId: INTAKE,
      noticeId: NOTICE,
      child: { givenName: 'Nia', familyName: 'Ivanova', birthDate: '2021-02-03' },
    });
    expect(() => applicationBody(form({ ...base, child: 'new', ...child, child_birth_date: '' }))).toThrow(
      FormProblem,
    );
    expect(() => applicationBody(form({ ...base, child: '' }))).toThrow('choose the child');
    expect(() => applicationBody(form({ ...base, notice_read: '', child: CHILD }))).toThrow('privacy notice');
  });

  it('reads an intake and refuses dates out of order', () => {
    const intake = {
      school_id: 'b1000000-0000-7000-8000-00000000000a',
      school_year: '2027/28',
      grade: '1',
      places: '20',
      opens_on: '2026-11-01',
      closes_on: '2027-01-31',
    };
    expect(intakeBody(form(intake))).toMatchObject({ schoolYear: '2027/28', places: 20 });
    expect(() => intakeBody(form({ ...intake, closes_on: '2026-10-01' }))).toThrow(FormProblem);
    expect(() => intakeBody(form({ ...intake, places: '0' }))).toThrow(FormProblem);
  });

  it('guesses the parent’s names for an invitation, and needs both', () => {
    expect(splitName('Lora Petkova (synthetic)')).toEqual({ givenName: 'Lora', familyName: 'Petkova' });
    expect(splitName('Ana Maria Popova')).toEqual({ givenName: 'Ana Maria', familyName: 'Popova' });
    expect(splitName('Cher')).toEqual({ givenName: 'Cher', familyName: '' });
    expect(() => inviteBody(form({ given_name: 'Cher', family_name: '' }))).toThrow(FormProblem);
  });
});

describe('offers in the portal', () => {
  it('reads the answer date and staff notes, and knows which applications are finished', () => {
    expect(offerBody(form({ answer_by: '2026-11-15' }))).toEqual({ answerBy: '2026-11-15' });
    expect(() => offerBody(form({ answer_by: '' }))).toThrow(FormProblem);
    expect(applicationNoteBody(form({ kind: 'assessment', body: 'Reads fluently' }))).toEqual({
      kind: 'assessment',
      body: 'Reads fluently',
    });
    expect(() => applicationNoteBody(form({ kind: 'note', body: '' }))).toThrow(FormProblem);
    expect(
      ['declined', 'expired', 'rejected', 'withdrawn'].every((status) => isFinished(status as 'declined')),
    ).toBe(true);
    expect(
      ['submitted', 'waitlisted', 'offered', 'accepted'].some((status) => isFinished(status as 'offered')),
    ).toBe(false);
  });
});
