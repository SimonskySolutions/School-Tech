import { type Inquiry, type InquiryForm, type SchoolInquiries } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, post, tokenFor } from './helpers';

// Inquiries from school websites (M5.1, ADR 0026) against the real stack.
// A family sends the School A website's form without signing in; the
// school's admissions staff see it, others do not; staff record a call and
// close it. The seed has Lora Petkova's inquiry to School A.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const SCHOOL_B = 'b1000000-0000-7000-8000-00000000000b';
const SITE_A = 'school-a.pythagoras.localhost';
const PARENT = 'Vera Test (integration test)';

const tokens: Record<string, string> = {};
let form: InquiryForm;

const publicForm = async (host: string) => {
  const response = await fetch(`${API}/sites/inquiry-form?host=${host}`);
  return { status: response.status, body: (await response.json()) as InquiryForm };
};
const send = async (body: Record<string, unknown>) => {
  const response = await fetch(`${API}/sites/inquiries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as { received?: boolean } };
};
const list = (user: string, status = 'open') =>
  get<SchoolInquiries>(`/admissions/inquiries?status=${status}`, tokens[user]!);
const vera = async (status = 'open'): Promise<Inquiry | undefined> =>
  (await list('principal.a', status)).body.inquiries.find((inquiry) => inquiry.parentName === PARENT);

beforeAll(async () => {
  for (const user of [
    'principal.a',
    'principal.c',
    'admin',
    'ceo',
    'schoollife',
    'kitchen.a',
    'anna.ivanova',
  ]) {
    tokens[user] = await tokenFor(user);
  }
  form = (await publicForm(SITE_A)).body;
});

describe('the inquiry form on a school website', () => {
  it('offers the website’s schools and the current privacy notice, without signing in', async () => {
    expect(form.schools).toEqual([{ id: SCHOOL_A, name: 'School A' }]);
    expect(form.notice.version).toBeGreaterThan(0);
    expect(form.notice.text).toContain('SYNTHETIC NOTICE');
    const group = (await publicForm('pythagoras.localhost')).body;
    expect(group.schools.map((school) => school.name)).toEqual(['School A', 'School B', 'School C']);
    expect((await publicForm('unknown.pythagoras.localhost')).status).toBe(404);
  });

  it('takes an inquiry, and answers a second one from the same address the same way', async () => {
    const inquiry = {
      host: SITE_A,
      schoolId: SCHOOL_A,
      noticeId: form.notice.id,
      parentName: PARENT,
      email: 'Vera.Test@example.test',
      phone: '+359 2 000 0000',
      childName: 'Lia',
      birthYear: 2019,
      gradeOfInterest: '2',
      intendedStart: 'September 2027',
      message: 'Is there a place in grade 2 next year?',
      newsConsent: true,
    };
    expect(await send(inquiry)).toEqual({ status: 202, body: { received: true } });
    expect(await send({ ...inquiry, message: 'Also: is there a bus?', newsConsent: false })).toEqual({
      status: 202,
      body: { received: true },
    });
    const sent = await vera();
    expect(sent).toMatchObject({
      school: { id: SCHOOL_A, name: 'School A' },
      status: 'new',
      email: 'vera.test@example.test',
      childName: 'Lia',
      birthYear: 2019,
      message: 'Is there a place in grade 2 next year?',
      newsConsent: true,
      noticeVersion: form.notice.version,
    });
    expect(sent!.notes).toEqual([
      expect.objectContaining({ kind: 'family_message', author: null, body: 'Also: is there a bus?' }),
    ]);
  });

  it('refuses another school, an old notice and anything the notice does not cover', async () => {
    const base = {
      host: SITE_A,
      schoolId: SCHOOL_A,
      noticeId: form.notice.id,
      parentName: 'Other Test (integration test)',
      email: 'other@example.test',
      newsConsent: false,
    };
    expect((await send({ ...base, schoolId: SCHOOL_B })).status).toBe(404);
    expect((await send({ ...base, noticeId: crypto.randomUUID() })).status).toBe(409);
    expect((await send({ ...base, dateOfBirth: '2019-04-01' })).status).toBe(400);
    expect((await send({ ...base, email: 'not an address' })).status).toBe(400);
    expect((await send({ ...base, host: 'unknown.pythagoras.localhost' })).status).toBe(404);
  });
});

describe('inquiries for admissions staff', () => {
  it('shows them to the school’s principal and the group administrator only', async () => {
    const principal = (await list('principal.a')).body.inquiries;
    expect(principal.map((inquiry) => inquiry.parentName)).toEqual(
      expect.arrayContaining([PARENT, 'Lora Petkova (synthetic)']),
    );
    const admin = (await list('admin')).body.inquiries;
    expect(admin.some((inquiry) => inquiry.parentName === PARENT)).toBe(true);
    const otherSchool = await list('principal.c');
    expect(otherSchool.status).toBe(200);
    expect(otherSchool.body.inquiries.some((inquiry) => inquiry.school.id === SCHOOL_A)).toBe(false);
    for (const user of ['ceo', 'schoollife', 'kitchen.a', 'anna.ivanova']) {
      expect((await list(user)).status).toBe(403);
    }
  });

  it('lets the principal record a call and close it, and no one at another school', async () => {
    const inquiry = (await vera())!;
    const path = `/admissions/inquiries/${inquiry.id}`;
    expect((await post(tokens['principal.c']!, `${path}/notes`, { kind: 'note', body: 'x' })).status).toBe(
      404,
    );
    expect(
      (await post(tokens['principal.a']!, `${path}/notes`, { kind: 'family_message', body: 'x' })).status,
    ).toBe(400);
    expect(
      await post(tokens['principal.a']!, `${path}/notes`, { kind: 'call', body: 'Invited to the open day.' }),
    ).toMatchObject({ status: 201, body: { status: 'contacted' } });
    expect((await post(tokens['principal.a']!, `${path}/close`, { outcome: 'applied' })).status).toBe(200);
    expect((await post(tokens['principal.a']!, `${path}/close`, { outcome: 'duplicate' })).status).toBe(409);
    expect((await post(tokens['principal.a']!, `${path}/notes`, { kind: 'note', body: 'late' })).status).toBe(
      409,
    );
    expect(await vera('open')).toBeUndefined();
    const closed = await vera('closed');
    expect(closed).toMatchObject({ status: 'closed', outcome: 'applied' });
    expect(closed!.notes.map((note) => note.kind)).toEqual(['family_message', 'call']);
    expect(closed!.notes[1]!.author).toBe('Petar Nikolov');
  });
});
