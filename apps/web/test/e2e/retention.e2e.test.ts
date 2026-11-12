import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Requests from a prospective family through the web app (M5.6): a family
// sends an inquiry from the School A website and later asks what is held
// about them and to be forgotten; the principal downloads the export and
// erases the inquiry, which then shows no name.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const WEB = 'http://web:3000';
const SITE_A = 'school-a.pythagoras.localhost';
const PARENT = 'Forget Me (e2e test)';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)![1]!;
const postForm = (browser: Browser, path: string, fields: [string, string][], origin = APP) =>
  browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams(fields),
  });

describe('a family asks what we hold and to be forgotten', () => {
  it('lets the principal download the export and erase the inquiry', async () => {
    const site = (path: string, init: RequestInit = {}) =>
      fetch(`${WEB}${path}`, {
        ...init,
        headers: { 'x-forwarded-host': `${SITE_A}:53000`, ...(init.headers as Record<string, string>) },
        redirect: 'manual',
      });
    const form = decode(await (await site('/inquiry')).text());
    await site('/inquiry/send', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://${SITE_A}:53000` },
      body: new URLSearchParams([
        ['school_id', hidden(form, 'school_id')],
        ['notice_id', hidden(form, 'notice_id')],
        ['parent_name', PARENT],
        ['email', `forget.e2e.${Date.now().toString(36)}@example.test`],
        ['message', 'A question to forget (synthetic).'],
        ['notice_read', 'yes'],
        ['news_consent', 'yes'],
      ]),
    });

    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const list = await open(principal, '/admissions/inquiries');
    const at = list.indexOf(`<h2>${PARENT}</h2>`);
    const inquiryId = /data-testid="inquiry-([0-9a-f-]{36})"/.exec(
      list.slice(list.lastIndexOf('<article', at)),
    )![1]!;

    const download = await postForm(principal, '/admissions/export', [
      ['kind', 'inquiry'],
      ['id', inquiryId],
    ]);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toBe(
      `attachment; filename="admissions-inquiry-${inquiryId}.json"`,
    );
    expect(download.headers.get('cache-control')).toBe('no-store');
    const exported = (await download.json()) as { inquiry: { parent_name: string; message: string } };
    expect(exported.inquiry).toMatchObject({
      parent_name: PARENT,
      message: 'A question to forget (synthetic).',
    });
    expect(
      (
        await postForm(
          principal,
          '/admissions/export',
          [
            ['kind', 'inquiry'],
            ['id', inquiryId],
          ],
          'http://evil.example',
        )
      ).status,
    ).toBe(403);

    const act = (fields: [string, string][]) => postForm(principal, '/admissions/inquiries/actions', fields);
    const notice = (response: Response, name: string) =>
      new URL(response.headers.get('location')!).searchParams.get(name);
    expect(
      notice(
        await act([
          ['action', 'withdraw-consent'],
          ['inquiry_id', inquiryId],
        ]),
        'done',
      ),
    ).toBe('consent-withdrawn');
    expect(
      notice(
        await act([
          ['action', 'erase'],
          ['inquiry_id', inquiryId],
        ]),
        'error',
      ),
    ).toContain('confirm');
    expect(
      notice(
        await act([
          ['action', 'erase'],
          ['inquiry_id', inquiryId],
          ['confirm', 'yes'],
        ]),
        'done',
      ),
    ).toBe('erased');

    const after = await open(principal, '/admissions/inquiries?status=all');
    expect(after).not.toContain(PARENT);
    const article = after.slice(after.indexOf(`data-testid="inquiry-${inquiryId}"`));
    expect(article.slice(0, article.indexOf('</article>'))).toContain('<h2>Erased inquiry</h2>');
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    expect(
      (
        await postForm(kitchen, '/admissions/export', [
          ['kind', 'inquiry'],
          ['id', inquiryId],
        ])
      ).status,
    ).toBe(404);
  });
});
