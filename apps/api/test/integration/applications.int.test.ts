import {
  type CreatedAccountResponse,
  type FamilyAdmissions,
  type InquiryForm,
  type SchoolApplications,
  type SchoolInquiries,
} from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, BORIS, get, keycloakAdmin, MILA, passwordGrant, post, tokenFor } from './helpers';

// Intakes, applications and invitations to apply (M5.2, ADR 0027) against
// the real stack. Anna applies for Boris (School C) and for a child the group
// does not know yet to the seeded grade 1 intake at School A; the principal
// reviews; Anna withdraws one. A family that only sent an inquiry is invited,
// gets a sign-in account, signs in and applies.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const SCHOOL_C = 'b1000000-0000-7000-8000-00000000000c';
const INTAKE = 'db000000-0000-7000-8000-0000000000a1';
const run = Date.now().toString(36);
const APPLICANT = `test-${run}-applicant@pythagoras.test`;

const tokens: Record<string, string> = {};
let family: FamilyAdmissions;
let borisApplication: string;
let niaApplication: string;

const staffView = (user: string) => get<SchoolApplications>('/admissions/applications', tokens[user]!);

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'hristo.georgiev', 'principal.a', 'principal.c', 'ceo', 'schoollife']) {
    tokens[user] = await tokenFor(user);
  }
  family = (await get<FamilyAdmissions>('/admissions/family', tokens['anna.ivanova']!)).body;
});

describe('applying for a place', () => {
  it('shows Anna the open intake, her children and the privacy notice', () => {
    expect(family.intakes).toContainEqual(
      expect.objectContaining({
        id: INTAKE,
        school: { id: SCHOOL_A, name: 'School A' },
        schoolYear: '2027/28',
        grade: '1',
        takingApplications: true,
      }),
    );
    expect(family.children.map((child) => child.name).sort()).toEqual(['Boris Ivanov', 'Mila Ivanova']);
    expect(family.notice?.version).toBeGreaterThan(0);
  });

  it('takes an application for one of her children and for a new child, once each', async () => {
    const base = { intakeId: INTAKE, noticeId: family.notice!.id };
    const boris = await post<{ id: string }>(tokens['anna.ivanova']!, '/admissions/applications', {
      ...base,
      studentId: BORIS,
      message: 'Boris would join his sister.',
    });
    expect(boris.status).toBe(201);
    borisApplication = boris.body.id;
    expect(
      (await post(tokens['anna.ivanova']!, '/admissions/applications', { ...base, studentId: BORIS })).status,
    ).toBe(409);
    expect(
      (await post(tokens['anna.ivanova']!, '/admissions/applications', { ...base, studentId: MILA })).status,
    ).toBe(409);
    expect(
      (await post(tokens['hristo.georgiev']!, '/admissions/applications', { ...base, studentId: BORIS }))
        .status,
    ).toBe(404);
    const nia = await post<{ id: string }>(tokens['anna.ivanova']!, '/admissions/applications', {
      ...base,
      child: { givenName: 'Nia', familyName: 'Ivanova', birthDate: '2021-02-03' },
      currentSchool: 'Kindergarten 12 (synthetic)',
    });
    expect(nia.status).toBe(201);
    niaApplication = nia.body.id;
    expect(
      (
        await post(tokens['anna.ivanova']!, '/admissions/applications', {
          ...base,
          noticeId: crypto.randomUUID(),
          studentId: BORIS,
        })
      ).status,
    ).toBe(409);
  });

  it('shows the applications to the principal of School A only, with the children and the parent', async () => {
    const { status, body } = await staffView('principal.a');
    expect(status).toBe(200);
    expect(body.schools.map((school) => school.name)).toEqual(['School A']);
    const boris = body.applications.find((application) => application.id === borisApplication);
    expect(boris).toMatchObject({
      status: 'submitted',
      child: { name: 'Boris Ivanov', birthDate: '2020-05-20', known: true },
      applicant: { name: 'Anna Ivanova', email: 'anna.ivanova@pythagoras.test' },
      message: 'Boris would join his sister.',
    });
    expect(body.applications.find((application) => application.id === niaApplication)).toMatchObject({
      child: {
        name: 'Nia Ivanova',
        birthDate: '2021-02-03',
        known: false,
        currentSchool: 'Kindergarten 12 (synthetic)',
      },
    });
    expect(body.intakes.find((intake) => intake.id === INTAKE)!.applications.live).toBeGreaterThanOrEqual(2);
    const otherSchool = await staffView('principal.c');
    expect(otherSchool.body.applications.some((application) => application.school.id === SCHOOL_A)).toBe(
      false,
    );
    for (const user of ['ceo', 'schoollife', 'anna.ivanova'])
      expect((await staffView(user)).status).toBe(403);
  });

  it('lets the principal review and Anna withdraw, each only their own part', async () => {
    const review = (user: string, id: string) => post(tokens[user]!, `/admissions/applications/${id}/review`);
    const withdraw = (user: string, id: string) =>
      post(tokens[user]!, `/admissions/applications/${id}/withdraw`);
    expect((await review('principal.c', borisApplication)).status).toBe(404);
    expect((await review('principal.a', borisApplication)).status).toBe(200);
    expect((await review('principal.a', borisApplication)).status).toBe(409);
    expect((await withdraw('hristo.georgiev', niaApplication)).status).toBe(404);
    expect((await withdraw('anna.ivanova', niaApplication)).status).toBe(200);
    const mine = (await get<FamilyAdmissions>('/admissions/family', tokens['anna.ivanova']!)).body
      .applications;
    expect(mine.find((application) => application.id === borisApplication)!.status).toBe('under_review');
    expect(mine.find((application) => application.id === niaApplication)!.status).toBe('withdrawn');
    const hristo = (await get<FamilyAdmissions>('/admissions/family', tokens['hristo.georgiev']!)).body;
    expect(hristo.applications).toEqual([]);
  });
});

describe('intakes', () => {
  it('lets the principal open and close an intake at their own school only', async () => {
    const intake = {
      schoolId: SCHOOL_A,
      schoolYear: '2028/29',
      grade: `t${run}`,
      places: 12,
      opensOn: new Date().toISOString().slice(0, 10),
      closesOn: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    };
    const opened = await post<{ id: string }>(tokens['principal.a']!, '/admissions/intakes', intake);
    expect(opened.status).toBe(201);
    expect((await post(tokens['principal.a']!, '/admissions/intakes', intake)).status).toBe(409);
    expect(
      (await post(tokens['principal.a']!, '/admissions/intakes', { ...intake, schoolId: SCHOOL_C })).status,
    ).toBe(403);
    const seen = async () =>
      (await get<FamilyAdmissions>('/admissions/family', tokens['hristo.georgiev']!)).body.intakes.some(
        (open) => open.id === opened.body.id,
      );
    expect(await seen()).toBe(true);
    expect((await post(tokens['principal.a']!, `/admissions/intakes/${opened.body.id}/close`)).status).toBe(
      200,
    );
    expect((await post(tokens['principal.a']!, `/admissions/intakes/${opened.body.id}/close`)).status).toBe(
      409,
    );
    expect(await seen()).toBe(false);
  });
});

describe('inviting a family that sent an inquiry', () => {
  let invited: CreatedAccountResponse;

  it('creates the parent and a sign-in account, once, and nothing for a known address', async () => {
    const form = (await (
      await fetch(`${API}/sites/inquiry-form?host=school-a.pythagoras.localhost`)
    ).json()) as InquiryForm;
    const send = (email: string) =>
      fetch(`${API}/sites/inquiries`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          host: 'school-a.pythagoras.localhost',
          schoolId: SCHOOL_A,
          noticeId: form.notice.id,
          parentName: 'Applicant Test (integration test)',
          email,
          newsConsent: false,
        }),
      });
    expect((await send(APPLICANT)).status).toBe(202);
    expect((await send('hristo.georgiev@pythagoras.test')).status).toBe(202);
    const inquiries = (await get<SchoolInquiries>('/admissions/inquiries', tokens['principal.a']!)).body
      .inquiries;
    const fresh = inquiries.find((inquiry) => inquiry.email === APPLICANT)!;
    const known = inquiries.find((inquiry) => inquiry.email === 'hristo.georgiev@pythagoras.test')!;
    const invite = (user: string, id: string) =>
      post<CreatedAccountResponse>(tokens[user]!, `/admissions/inquiries/${id}/invite`, {
        givenName: 'Vera',
        familyName: 'Test',
      });

    expect((await invite('principal.c', fresh.id)).status).toBe(404);
    const known409 = await invite('principal.a', known.id);
    expect(known409.status).toBe(409);
    expect(known409.body.message).toContain('already known');
    const response = await invite('principal.a', fresh.id);
    expect(response.status).toBe(201);
    invited = response.body;
    expect(invited).toMatchObject({ username: APPLICANT, setup: 'temporary_password' });
    expect(invited.temporaryPassword).toMatch(/^[A-Za-z0-9]{24}$/);
    expect((await invite('principal.a', fresh.id)).status).toBe(409);
    const after = (await get<SchoolInquiries>('/admissions/inquiries', tokens['principal.a']!)).body
      .inquiries;
    expect(after.find((inquiry) => inquiry.id === fresh.id)!.invited).toBe(true);
    expect(after.find((inquiry) => inquiry.id === known.id)!.invited).toBe(false);
  });

  it('lets the invited parent sign in, see the intake and apply, with no child or role of theirs', async () => {
    // Stand in for the parent choosing a password at first sign-in.
    const admin = await keycloakAdmin();
    const [user] = (await (
      await admin(`/users?username=${encodeURIComponent(APPLICANT)}&exact=true`)
    ).json()) as { id: string }[];
    const chosen = `Chosen-${run}-Passw0rd`;
    await admin(`/users/${user!.id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [] }) });
    await admin(`/users/${user!.id}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ type: 'password', value: chosen, temporary: false }),
    });
    const grant = await passwordGrant(APPLICANT, chosen);
    expect(grant.status).toBe(200);
    const token = ((await grant.json()) as { access_token: string }).access_token;

    const view = (await get<FamilyAdmissions>('/admissions/family', token)).body;
    expect(view.children).toEqual([]);
    expect(view.intakes.some((intake) => intake.id === INTAKE)).toBe(true);
    const applied = await post(token, '/admissions/applications', {
      intakeId: INTAKE,
      noticeId: view.notice!.id,
      child: { givenName: 'Lia', familyName: 'Test', birthDate: '2021-06-01' },
    });
    expect(applied.status).toBe(201);
    expect((await get('/school-life/kitchen', token)).status).toBe(403);
    const staff = (await staffView('principal.a')).body.applications;
    expect(staff.find((application) => application.applicant.email === APPLICANT)).toMatchObject({
      applicant: { name: 'Vera Test' },
      child: { name: 'Lia Test', known: false },
    });
  });
});
