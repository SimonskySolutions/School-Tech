import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Consent from families through the web app (M6.6, ADR 0030): Anna consents to
// recordings of Mila's performances, the principal of School A sees who may
// appear, the data protection officer changes the website wording in
// substance so Anna is asked again, and Anna withdraws the recordings consent.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const MILA = 'c1000000-0000-7000-8000-000000000030';

const decode = (value: string) =>
  value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const send = (browser: Browser, path: string, fields: [string, string][]) =>
  browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
const notice = (response: Response, name: string) =>
  new URL(response.headers.get('location')!).searchParams.get(name);
const section = (page: string, testId: string) => {
  const start = page.indexOf(`data-testid="${testId}"`);
  return page.slice(start, page.indexOf('</section>', start));
};
const field = (html: string, name: string) =>
  new RegExp(`name="${name}" value="([0-9a-f-]{36})"`).exec(html)![1]!;
/** Mila's row on the staff page, cell by purpose code. */
const milaRow = async (browser: Browser) => {
  const page = await open(browser, `/schools/${SCHOOL_A}/consents`);
  const row = page.slice(
    page.indexOf(`data-testid="pupil-${MILA}"`),
    page.indexOf('</tr>', page.indexOf(`data-testid="pupil-${MILA}"`)),
  );
  return (code: string) => new RegExp(`data-testid="${code.replace('.', '\\.')}">([^<]*)<`).exec(row)?.[1];
};

describe('consent from families', () => {
  it('is given and withdrawn by a guardian, and staff see who may appear', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    expect(await open(anna, '/')).toContain(`href="/children/${MILA}/consents"`);
    const page = await open(anna, `/children/${MILA}/consents`);
    expect(section(page, 'consent-photos.website')).toContain('Consent given by Anna Ivanova');
    const recordings = section(page, 'consent-recordings.events');
    expect(recordings).toContain('No consent given.');
    const action = `/children/${MILA}/consents/actions`;
    const give = [
      ['action', 'give'],
      ['purpose_id', field(recordings, 'purpose_id')],
      ['wording_id', field(recordings, 'wording_id')],
    ] as [string, string][];
    expect(notice(await send(anna, action, give), 'error')).toContain('tick the box');
    expect(notice(await send(anna, action, [...give, ['agree', 'yes']]), 'done')).toBe('given');

    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    let cell = await milaRow(principal);
    expect([cell('photos.website'), cell('photos.print'), cell('recordings.events')]).toEqual([
      'Yes',
      'No',
      'Yes',
    ]);
    expect(await open(principal, `/schools/${SCHOOL_A}/consents`)).not.toContain('Anna');

    const dpo = (await signIn('dpo@pythagoras.test', PASSWORD)).browser;
    const wording = await open(dpo, '/privacy/consents');
    const website = section(wording, 'purpose-photos.website');
    expect(website).toContain('Version 1');
    expect(
      notice(
        await send(dpo, '/privacy/consents/actions', [
          ['purpose_id', field(website, 'purpose_id')],
          [
            'wording',
            'The school may publish photos of your child with their first name on its website (e2e test).',
          ],
          ['renewal_required', 'yes'],
        ]),
        'done',
      ),
    ).toBe('published');
    cell = await milaRow(principal);
    expect(cell('photos.website')).toBe('No: asked again');
    expect(section(await open(anna, `/children/${MILA}/consents`), 'consent-photos.website')).toContain(
      'The school has changed what it asks',
    );

    expect(
      notice(
        await send(anna, action, [
          ['action', 'withdraw'],
          ['purpose_id', field(recordings, 'purpose_id')],
        ]),
        'done',
      ),
    ).toBe('withdrawn');
    expect((await milaRow(principal))('recordings.events')).toBe('No');

    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    expect(await open(teacher, `/schools/${SCHOOL_A}/consents`)).toContain('data-testid="not-permitted"');
    expect(await open(principal, '/privacy/consents')).toContain('data-testid="not-permitted"');
  });
});
