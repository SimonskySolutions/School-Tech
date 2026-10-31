import {
  type FamilyAdmissions,
  type InquiryForm,
  type SchoolApplications,
  type SchoolInquiries,
} from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, post, tokenFor } from './helpers';

// Requests from prospective families (M5.6) against the real stack: an
// inquiry's sender asks what is held about them, withdraws the open-day
// consent and asks to be erased; an application is exported and erased.
// The worker's retention job is covered by the database and worker tests.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const INTAKE = 'db000000-0000-7000-8000-0000000000a1';
const EMAIL = `forget.${Date.now().toString(36)}@example.test`;

const tokens: Record<string, string> = {};
let inquiryId: string;

const inquiries = async () =>
  (await get<SchoolInquiries>('/admissions/inquiries?status=all', tokens['principal.a']!)).body.inquiries;
const exportOf = async (user: string, path: string) => {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens[user]!}` },
  });
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    body: response.ok ? ((await response.json()) as Record<string, unknown>) : null,
  };
};

beforeAll(async () => {
  for (const user of ['principal.a', 'principal.c', 'ceo', 'anna.ivanova'])
    tokens[user] = await tokenFor(user);
  const form = (await (
    await fetch(`${API}/sites/inquiry-form?host=school-a.pythagoras.localhost`)
  ).json()) as InquiryForm;
  await fetch(`${API}/sites/inquiries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      host: 'school-a.pythagoras.localhost',
      schoolId: SCHOOL_A,
      noticeId: form.notice.id,
      parentName: 'Forget Me (integration test)',
      email: EMAIL,
      message: 'Please tell me about grade 1 (synthetic).',
      newsConsent: true,
    }),
  });
  inquiryId = (await inquiries()).find((inquiry) => inquiry.email === EMAIL)!.id;
});

describe('requests from the sender of an inquiry', () => {
  it('exports what is held about them to the school’s admissions staff only', async () => {
    const exported = await exportOf('principal.a', `/admissions/inquiries/${inquiryId}/export`);
    expect(exported.status).toBe(200);
    expect(exported.cache).toBe('no-store');
    expect(exported.body).toMatchObject({
      school: 'School A',
      inquiry: {
        parent_name: 'Forget Me (integration test)',
        email: EMAIL,
        message: 'Please tell me about grade 1 (synthetic).',
      },
    });
    expect((await exportOf('principal.c', `/admissions/inquiries/${inquiryId}/export`)).status).toBe(404);
    expect((await exportOf('ceo', `/admissions/inquiries/${inquiryId}/export`)).status).toBe(404);
  });

  it('records that they want no more news, once', async () => {
    const path = `/admissions/inquiries/${inquiryId}/withdraw-consent`;
    expect((await post(tokens['principal.a']!, path)).status).toBe(200);
    expect((await post(tokens['principal.a']!, path)).status).toBe(409);
    expect((await inquiries()).find((inquiry) => inquiry.id === inquiryId)!.newsConsent).toBe(false);
  });

  it('erases the inquiry on request, keeping only that it was there', async () => {
    const path = `/admissions/inquiries/${inquiryId}/erase`;
    expect((await post(tokens['principal.c']!, path)).status).toBe(404);
    expect((await post(tokens['principal.a']!, path)).status).toBe(200);
    expect((await post(tokens['principal.a']!, path)).status).toBe(409);
    expect((await inquiries()).find((inquiry) => inquiry.id === inquiryId)).toMatchObject({
      status: 'closed',
      parentName: null,
      email: null,
      message: null,
    });
    const exported = await exportOf('principal.a', `/admissions/inquiries/${inquiryId}/export`);
    expect(JSON.stringify(exported.body)).not.toContain('Forget Me');
  });
});

describe('requests about an application', () => {
  it('exports and erases an application, withdrawing it first', async () => {
    const family = (await get<FamilyAdmissions>('/admissions/family', tokens['anna.ivanova']!)).body;
    const applied = await post<{ id: string }>(tokens['anna.ivanova']!, '/admissions/applications', {
      intakeId: INTAKE,
      noticeId: family.notice!.id,
      child: { givenName: 'Era', familyName: 'Ivanova', birthDate: '2021-08-08' },
      message: 'Era loves drawing (synthetic).',
    });
    const id = applied.body.id;
    const exported = await exportOf('principal.a', `/admissions/applications/${id}/export`);
    expect(exported.body).toMatchObject({
      application: {
        child: { given_name: 'Era', date_of_birth: '2021-08-08' },
        message: 'Era loves drawing (synthetic).',
      },
    });
    expect((await post(tokens['anna.ivanova']!, `/admissions/applications/${id}/erase`)).status).toBe(404);
    expect((await post(tokens['principal.a']!, `/admissions/applications/${id}/erase`)).status).toBe(200);
    const staff = (
      await get<SchoolApplications>(`/admissions/applications?intakeId=${INTAKE}`, tokens['principal.a']!)
    ).body.applications;
    expect(staff.find((application) => application.id === id)).toMatchObject({
      status: 'withdrawn',
      erased: true,
      child: { name: null, birthDate: null },
      message: null,
    });
    const mine = (await get<FamilyAdmissions>('/admissions/family', tokens['anna.ivanova']!)).body
      .applications;
    expect(mine.find((application) => application.id === id)).toMatchObject({
      status: 'withdrawn',
      childName: null,
    });
  });
});
