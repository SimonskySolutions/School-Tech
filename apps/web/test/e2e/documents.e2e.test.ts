import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Private documents through the web app (M6.4, ADR 0029): the principal of
// School A files a policy for all staff and the kitchen's contract; the
// kitchen downloads the policy through a single-use link and finds the
// contract on "My employment"; a teacher at School B sees none of it.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const POLICY = '%PDF-1.7\n% Fire drill policy (synthetic)\n%%EOF\n';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const send = (browser: Browser, path: string, body: FormData) =>
  browser.request(`${APP}${path}`, { method: 'POST', headers: { origin: APP }, body, redirect: 'manual' });
const notice = (response: Response, name: string) =>
  new URL(response.headers.get('location')!).searchParams.get(name);
const fields = (entries: [string, string | File][]) => {
  const form = new FormData();
  for (const [name, value] of entries) form.append(name, value);
  return form;
};
/** The id of the newest version of the document with this title, from a page. */
const versionOf = (page: string, title: string) => {
  const entry = page.slice(page.indexOf(`<strong>${title}</strong>`));
  return /name="version_id" value="([0-9a-f-]{36})"/.exec(entry)?.[1];
};

describe('private documents', () => {
  it('files a policy for all staff, which the kitchen downloads once through its own link', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await open(principal, '/')).toContain(`href="/schools/${SCHOOL_A}/documents"`);
    const act = (entries: [string, string | File][]) =>
      send(principal, `/schools/${SCHOOL_A}/documents/actions`, fields(entries));
    const policy = new File([POLICY], 'fire-drill.pdf', { type: 'application/pdf' });
    expect(
      notice(
        await act([
          ['action', 'file'],
          ['title', 'Fire drill policy (e2e test)'],
          ['category', 'policy'],
          ['attached', 'school'],
          ['for_all_staff', 'yes'],
          ['file', new File(['<html>'], 'fire-drill.html', { type: 'text/html' })],
        ]),
        'error',
      ),
    ).toContain('only');
    expect(
      notice(
        await act([
          ['action', 'file'],
          ['title', 'Fire drill policy (e2e test)'],
          ['category', 'policy'],
          ['attached', 'school'],
          ['for_all_staff', 'yes'],
          ['file', policy],
        ]),
        'done',
      ),
    ).toBe('filed');
    expect(
      notice(
        await act([
          ['action', 'file'],
          ['title', 'Contract (e2e test)'],
          ['category', 'contract'],
          ['attached', `staff:${KITCHEN_A}`],
          ['file', new File(['%PDF-1.7\n% contract\n'], 'contract.pdf', { type: 'application/pdf' })],
        ]),
        'done',
      ),
    ).toBe('filed');
    const page = await open(principal, `/schools/${SCHOOL_A}/documents`);
    expect(page).toContain('Fire drill policy (e2e test)</strong> · Policy · for all staff');
    expect(page).toContain('Contract (e2e test)</strong> · Contract · Radka Mineva');

    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const seen = await open(kitchen, `/schools/${SCHOOL_A}/documents`);
    expect(seen).not.toContain('File a document');
    const versionId = versionOf(seen, 'Fire drill policy (e2e test)')!;
    expect(versionId).toBeDefined();
    const asked = await send(
      kitchen,
      '/documents/download',
      fields([
        ['version_id', versionId],
        ['back', `/schools/${SCHOOL_A}/documents`],
      ]),
    );
    expect(asked.status).toBe(303);
    const link = new URL(asked.headers.get('location')!);
    expect(link.pathname).toMatch(/^\/documents\/files\/[A-Za-z0-9_-]{43}$/);
    const file = await kitchen.request(link.href);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="fire-drill.pdf"/);
    expect(file.headers.get('cache-control')).toBe('no-store');
    expect(await file.text()).toBe(POLICY);
    expect((await kitchen.request(link.href)).status).toBe(404);

    const mine = await open(kitchen, '/staff/me');
    expect(mine).toContain('data-testid="my-documents"');
    expect(mine).toContain('Contract: Contract (e2e test)');

    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    expect(await open(teacher, `/schools/${SCHOOL_A}/documents`)).toContain('data-testid="not-permitted"');
    const borrowed = await send(
      teacher,
      '/documents/download',
      fields([
        ['version_id', versionId],
        ['back', '/'],
      ]),
    );
    expect(notice(borrowed, 'error')).toContain('no such document');
  });
});
