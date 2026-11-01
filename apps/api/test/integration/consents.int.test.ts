import { type ConsentPurposes, type SchoolConsents, type StudentConsents } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, MILA, post, tokenFor } from './helpers';

// Consent from families (M6.6, ADR 0030) against the real stack. The seed has
// three purposes with wording and Anna's consent for Mila's photos on the
// website; Anna also consents to print, the data protection officer changes
// the website wording in substance, Anna is asked again and agrees, then
// withdraws print. Staff see only who may appear.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const tokens: Record<string, string> = {};

const milaFor = async (user: string) =>
  (await get<StudentConsents>(`/students/${MILA}/consents`, tokens[user]!)).body;
const purpose = (consents: StudentConsents, code: string) =>
  consents.consents.find((entry) => entry.code === code)!;
const atSchoolA = async (user: string) => get<SchoolConsents>(`/schools/${SCHOOL_A}/consents`, tokens[user]!);
const milaAtA = async (code: string) => {
  const view = (await atSchoolA('principal.a')).body;
  const purposeId = view.purposes.find((entry) => entry.code === code)!.purposeId;
  return view.pupils.find((pupil) => pupil.personId === MILA)!.states[purposeId];
};
const give = (user: string, purposeId: string, wordingId: string) =>
  post(tokens[user]!, `/students/${MILA}/consents`, { purposeId, wordingId });

beforeAll(async () => {
  for (const user of [
    'anna.ivanova',
    'hristo.georgiev',
    'teodora.marinova',
    'principal.a',
    'teacher.b',
    'kitchen.a',
    'dpo',
  ]) {
    tokens[user] = await tokenFor(user);
  }
});

describe('consent from families', () => {
  it('shows a guardian each purpose with its wording, and records consent to that wording', async () => {
    const mila = await milaFor('anna.ivanova');
    expect(mila.mayConsent).toBe(true);
    expect(mila.consents.map((entry) => entry.code).sort()).toEqual([
      'photos.print',
      'photos.website',
      'recordings.events',
    ]);
    expect(purpose(mila, 'photos.website')).toMatchObject({
      state: 'given',
      givenBy: 'Anna Ivanova',
      givenForVersion: 1,
    });
    const print = purpose(mila, 'photos.print');
    expect(print.state).toBe('none');
    expect(print.wording.text).toContain('newsletter');

    expect((await give('anna.ivanova', print.purposeId, print.purposeId)).status).toBe(409);
    expect((await give('anna.ivanova', print.purposeId, print.wording.id)).status).toBe(201);
    expect((await give('anna.ivanova', print.purposeId, print.wording.id)).status).toBe(409);
    expect(purpose(await milaFor('anna.ivanova'), 'photos.print').state).toBe('given');

    expect((await get(`/students/${MILA}/consents`, tokens['hristo.georgiev']!)).status).toBe(404);
    expect((await give('hristo.georgiev', print.purposeId, print.wording.id)).status).toBe(404);
    expect((await get(`/students/${MILA}/consents`, tokens['teodora.marinova']!)).status).toBe(404);
  });

  it('shows staff who may appear, and nothing about who agreed', async () => {
    expect(await milaAtA('photos.website')).toBe('given');
    expect(await milaAtA('photos.print')).toBe('given');
    expect(await milaAtA('recordings.events')).toBe('none');
    const raw = JSON.stringify((await atSchoolA('principal.a')).body);
    expect(raw).not.toContain('Anna');
    expect((await atSchoolA('teacher.b')).status).toBe(404);
    expect((await atSchoolA('kitchen.a')).status).toBe(404);
    expect((await atSchoolA('anna.ivanova')).status).toBe(404);
  });

  it('asks again when the wording changes in substance', async () => {
    expect((await get('/privacy/consent-purposes', tokens['principal.a']!)).status).toBe(403);
    const purposes = (await get<ConsentPurposes>('/privacy/consent-purposes', tokens['dpo']!)).body.purposes;
    const website = purposes.find((entry) => entry.code === 'photos.website')!;
    expect(website.given).toBeGreaterThanOrEqual(1);
    const short = await post(tokens['dpo']!, `/privacy/consent-purposes/${website.purposeId}/wordings`, {
      wording: 'Photos.',
      renewalRequired: true,
    });
    expect(short.status).toBe(400);
    const published = await post(tokens['dpo']!, `/privacy/consent-purposes/${website.purposeId}/wordings`, {
      wording:
        'The school may publish photos and first names of your child on its website (integration test).',
      renewalRequired: true,
    });
    expect(published.status).toBe(201);
    expect(
      (
        await post(tokens['principal.a']!, `/privacy/consent-purposes/${website.purposeId}/wordings`, {
          wording: 'The school may publish anything it likes about your child.',
          renewalRequired: false,
        })
      ).status,
    ).toBe(403);

    const asked = purpose(await milaFor('anna.ivanova'), 'photos.website');
    expect(asked).toMatchObject({ state: 'renewal', givenForVersion: 1 });
    expect(asked.wording.text).toContain('first names');
    expect(await milaAtA('photos.website')).toBe('renewal');
    expect((await give('anna.ivanova', asked.purposeId, asked.wording.id)).status).toBe(201);
    expect(await milaAtA('photos.website')).toBe('given');
  });

  it('withdraws as easily as it gives, at once', async () => {
    const print = purpose(await milaFor('anna.ivanova'), 'photos.print');
    expect(
      (await post(tokens['hristo.georgiev']!, `/students/${MILA}/consents/${print.purposeId}/withdraw`))
        .status,
    ).toBe(404);
    expect(
      (await post(tokens['anna.ivanova']!, `/students/${MILA}/consents/${print.purposeId}/withdraw`)).status,
    ).toBe(200);
    expect(
      (await post(tokens['anna.ivanova']!, `/students/${MILA}/consents/${print.purposeId}/withdraw`)).status,
    ).toBe(409);
    expect(await milaAtA('photos.print')).toBe('none');
  });
});
