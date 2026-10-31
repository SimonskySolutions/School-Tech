import { type FamilyAdmissions, type SchoolApplications } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, post, tokenFor } from './helpers';

// Offers and the waiting list (M5.3) against the real stack. The principal
// of School A opens an intake with one place; Anna and Hristo each apply;
// the place goes to Anna, Hristo waits; Anna declines and the place passes to
// Hristo, who accepts. Notes stay with the staff. Expiry is covered by the
// database tests and the worker's unit test.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KALINA = 'c1000000-0000-7000-8000-000000000032';
const run = Date.now().toString(36);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const tokens: Record<string, string> = {};
let intakeId: string;
let noticeId: string;
let ola: string;
let kalina: string;

const family = async (user: string) =>
  (await get<FamilyAdmissions>('/admissions/family', tokens[user]!)).body;
const mine = async (user: string, id: string) =>
  (await family(user)).applications.find((application) => application.id === id)!;
const staff = async () =>
  (await get<SchoolApplications>(`/admissions/applications?intakeId=${intakeId}`, tokens['principal.a']!))
    .body;
const act = (user: string, id: string, what: string, body?: unknown) =>
  post(tokens[user]!, `/admissions/applications/${id}/${what}`, body);

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'hristo.georgiev', 'principal.a', 'principal.c']) {
    tokens[user] = await tokenFor(user);
  }
  const opened = await post<{ id: string }>(tokens['principal.a']!, '/admissions/intakes', {
    schoolId: SCHOOL_A,
    schoolYear: '2028/29',
    grade: `o${run}`,
    places: 1,
    opensOn: day(0),
    closesOn: day(30),
  });
  intakeId = opened.body.id;
  noticeId = (await family('anna.ivanova')).notice!.id;
  ola = (
    await post<{ id: string }>(tokens['anna.ivanova']!, '/admissions/applications', {
      intakeId,
      noticeId,
      child: { givenName: 'Ola', familyName: 'Ivanova', birthDate: '2021-04-04' },
    })
  ).body.id;
  kalina = (
    await post<{ id: string }>(tokens['hristo.georgiev']!, '/admissions/applications', {
      intakeId,
      noticeId,
      studentId: KALINA,
    })
  ).body.id;
});

describe('offers within the places', () => {
  it('offers the one place once, and puts the other application on the waiting list', async () => {
    expect((await act('principal.c', ola, 'offer', { answerBy: day(7) })).status).toBe(404);
    expect((await act('principal.a', ola, 'offer', { answerBy: day(-1) })).status).toBe(422);
    expect((await act('principal.a', ola, 'offer', { answerBy: day(7) })).status).toBe(200);
    const second = await act('principal.a', kalina, 'offer', { answerBy: day(7) });
    expect(second.status).toBe(409);
    expect(second.body.message).toContain('no place left');
    expect((await act('principal.a', kalina, 'decision', { decision: 'waitlisted' })).status).toBe(200);

    const view = await staff();
    expect(view.intakes.find((intake) => intake.id === intakeId)).toMatchObject({
      free: 0,
      applications: { offered: 1, waitlisted: 1 },
    });
    expect(view.applications.find((application) => application.id === kalina)!.waitlistPosition).toBe(1);
    expect((await mine('anna.ivanova', ola)).status).toBe('offered');
    expect((await mine('anna.ivanova', ola)).offerExpiresAt).not.toBeNull();
    expect(await mine('hristo.georgiev', kalina)).toMatchObject({
      status: 'waitlisted',
      waitlistPosition: 1,
    });
  });

  it('passes a declined place to the waiting list, and only the family answers', async () => {
    expect((await act('hristo.georgiev', ola, 'answer', { accept: true })).status).toBe(404);
    expect((await act('principal.a', ola, 'answer', { accept: true })).status).toBe(404);
    expect(await act('anna.ivanova', ola, 'answer', { accept: false })).toMatchObject({
      status: 200,
      body: { status: 'declined' },
    });
    const offered = await mine('hristo.georgiev', kalina);
    expect(offered.status).toBe('offered');
    // The intake's fourteen days to answer, to the end of that day in Sofia.
    const days = (new Date(offered.offerExpiresAt!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13);
    expect(days).toBeLessThan(16);
    expect(await act('hristo.georgiev', kalina, 'answer', { accept: true })).toMatchObject({
      status: 200,
      body: { status: 'accepted' },
    });
    expect((await act('hristo.georgiev', kalina, 'answer', { accept: false })).status).toBe(409);
    expect((await staff()).intakes.find((intake) => intake.id === intakeId)).toMatchObject({
      free: 0,
      applications: { accepted: 1, offered: 0, waitlisted: 0 },
    });
  });

  it('refuses an application, which the family then sees', async () => {
    const pia = await post<{ id: string }>(tokens['anna.ivanova']!, '/admissions/applications', {
      intakeId,
      noticeId,
      child: { givenName: 'Pia', familyName: 'Ivanova', birthDate: '2021-05-05' },
    });
    expect((await act('principal.a', pia.body.id, 'decision', { decision: 'rejected' })).status).toBe(200);
    expect((await act('principal.a', pia.body.id, 'offer', { answerBy: day(7) })).status).toBe(409);
    expect((await mine('anna.ivanova', pia.body.id)).status).toBe('rejected');
  });
});

describe('assessment notes', () => {
  it('keeps notes with the school’s admissions staff', async () => {
    expect(
      (
        await act('principal.a', kalina, 'notes', {
          kind: 'interview',
          body: 'Calm and curious (integration test).',
        })
      ).status,
    ).toBe(201);
    expect((await act('hristo.georgiev', kalina, 'notes', { kind: 'note', body: 'x' })).status).toBe(404);
    const note = (await staff()).applications.find((application) => application.id === kalina)!.notes;
    expect(note).toEqual([
      expect.objectContaining({
        kind: 'interview',
        author: 'Petar Nikolov',
        body: 'Calm and curious (integration test).',
      }),
    ]);
    expect(JSON.stringify(await family('hristo.georgiev'))).not.toContain('Calm and curious');
  });
});
