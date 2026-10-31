import { type FamilyAdmissions, type MeResponse, type SchoolApplications } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, invitedParent, offeringsOf, post, tokenFor } from './helpers';

// The enrolment hand-off (M5.4) against the real stack. A family new to the
// group, invited from an inquiry, applies for their child to a one-place
// intake at School A; the principal enrols her once the place is accepted,
// and the parent books for her. The same child, now known to the group, is
// then enrolled at School B as herself. Only this family changes, so no other
// test file sees a seeded family gain a child or an enrolment.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const SCHOOL_B = 'b1000000-0000-7000-8000-00000000000b';
const run = Date.now().toString(36);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const tokens: Record<string, string> = {};
let noticeId: string;
let intakeA: string;
let ema: string;
let emaId: string;

const act = (user: string, id: string, what: string, body?: unknown) =>
  post<{ status: string; studentId?: string }>(tokens[user]!, `/admissions/applications/${id}/${what}`, body);
const openIntake = async (user: string, schoolId: string) =>
  (
    await post<{ id: string }>(tokens[user]!, '/admissions/intakes', {
      schoolId,
      schoolYear: '2028/29',
      grade: `e${run}`,
      places: 1,
      opensOn: day(0),
      closesOn: day(30),
    })
  ).body.id;

beforeAll(async () => {
  for (const user of ['hristo.georgiev', 'principal.a', 'principal.c', 'kitchen.a', 'admin']) {
    tokens[user] = await tokenFor(user);
  }
  tokens.parent = (await invitedParent(tokens['principal.a']!, 'Enrol')).token;
  intakeA = await openIntake('principal.a', SCHOOL_A);
  noticeId = (await get<FamilyAdmissions>('/admissions/family', tokens.parent)).body.notice!.id;
  ema = (
    await post<{ id: string }>(tokens.parent, '/admissions/applications', {
      intakeId: intakeA,
      noticeId,
      child: { givenName: 'Ema', familyName: 'Test', birthDate: '2021-07-07' },
    })
  ).body.id;
  await act('principal.a', ema, 'offer', { answerBy: day(7) });
  await act('parent', ema, 'answer', { accept: true });
});

describe('enrolling an accepted place', () => {
  it('enrols a child new to the group once, with the parent as verified guardian', async () => {
    // From today, so the family can book at once.
    const start = { startDate: day(0), classLabel: '1A', relationship: 'mother' };
    expect((await act('principal.c', ema, 'enrol', start)).status).toBe(404);
    expect((await act('kitchen.a', ema, 'enrol', start)).status).toBe(404);
    expect((await act('parent', ema, 'enrol', start)).status).toBe(404);
    expect((await act('principal.a', ema, 'enrol', { startDate: day(0) })).status).toBe(422);
    const enrolled = await act('principal.a', ema, 'enrol', start);
    expect(enrolled).toMatchObject({ status: 200, body: { status: 'enrolled' } });
    emaId = enrolled.body.studentId!;
    expect((await act('principal.a', ema, 'enrol', start)).status).toBe(409);
    expect((await act('parent', ema, 'withdraw')).status).toBe(409);

    const me = (await get<MeResponse>('/me', tokens.parent!)).body;
    const child = me.children.find((candidate) => candidate.id === emaId)!;
    expect(child).toMatchObject({ givenName: 'Ema', familyName: 'Test' });
    expect(child.enrolments.find((enrolment) => enrolment.school.id === SCHOOL_A)?.classLabel).toBe('1A');
    const mine = (await get<FamilyAdmissions>('/admissions/family', tokens.parent!)).body;
    expect(mine.applications.find((application) => application.id === ema)).toMatchObject({
      status: 'enrolled',
      childName: 'Ema Test',
    });
    const view = (
      await get<SchoolApplications>(`/admissions/applications?intakeId=${intakeA}`, tokens['principal.a']!)
    ).body;
    expect(view.intakes.find((intake) => intake.id === intakeA)).toMatchObject({
      free: 0,
      applications: { enrolled: 1, accepted: 0 },
    });
    expect(view.applications.find((application) => application.id === ema)).toMatchObject({
      status: 'enrolled',
      child: { name: 'Ema Test', birthDate: '2021-07-07', known: true },
    });
  });

  it('lets the parent book for the new child at the new school, and nobody else', async () => {
    const offerings = await offeringsOf(tokens.parent!, emaId);
    expect(offerings.lunch.name).toBe('Lunch at School A');
    expect((await get(`/students/${emaId}/offerings`, tokens['hristo.georgiev']!)).status).toBe(404);
  });

  it('enrols a child of the group as themselves, with services opening at the start date', async () => {
    const intakeB = await openIntake('admin', SCHOOL_B);
    const application = (
      await post<{ id: string }>(tokens.parent!, '/admissions/applications', {
        intakeId: intakeB,
        noticeId,
        studentId: emaId,
      })
    ).body.id;
    await act('admin', application, 'offer', { answerBy: day(7) });
    await act('parent', application, 'answer', { accept: true });
    expect(await act('admin', application, 'enrol', { startDate: '2028-09-15' })).toMatchObject({
      status: 200,
      body: { studentId: emaId },
    });
    const me = (await get<MeResponse>('/me', tokens.parent!)).body;
    const child = me.children.find((candidate) => candidate.id === emaId)!;
    expect(child.enrolments.map((enrolment) => enrolment.school.name).sort()).toEqual([
      'School A',
      'School B',
    ]);
    // Services at School B open once that enrolment starts.
    const offerings = await get<unknown>(`/students/${emaId}/offerings`, tokens.parent!);
    expect(JSON.stringify(offerings.body)).not.toContain('Lunch at School B');
    expect(me.children).toHaveLength(1);
  });
});
