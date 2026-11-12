import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Inquiries through the web app (M5.1, ADR 0026). A family that does not
// attend yet uses the "Ask about a place" form on the School A website,
// without signing in; the principal of School A sees it in the portal, logs a
// call and closes it. Requests go to the web service with the host the
// gateway would forward, like the website tests.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const WEB = 'http://web:3000';
const SITE_A = 'school-a.pythagoras.localhost';
const PARENT = 'Vera Test (e2e test)';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const site = (host: string, path: string, init: RequestInit = {}) =>
  fetch(`${WEB}${path}`, {
    ...init,
    headers: { 'x-forwarded-host': `${host}:53000`, ...(init.headers as Record<string, string>) },
    redirect: 'manual',
  });
const sendForm = (fields: [string, string][], origin = `http://${SITE_A}:53000`) =>
  site(SITE_A, '/inquiry/send', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams(fields),
  });
const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)![1]!;

async function postForm(browser: Browser, path: string, fields: [string, string][]) {
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
}

describe('asking about a place on a school website', () => {
  it('links to the form from the website and shows the privacy notice, with the news consent unticked', async () => {
    const home = await (await site(SITE_A, '/')).text();
    expect(home).toContain('href="/inquiry"');
    const page = decode(await (await site(SITE_A, '/inquiry')).text());
    expect(page).toContain('Ask about a place');
    expect(page).toContain('SYNTHETIC NOTICE FOR DEVELOPMENT, NOT LEGAL TEXT');
    expect(page).toMatch(/<input type="checkbox" name="news_consent" value="yes"\/>/);
    expect(page).not.toContain('date of birth');
    expect(page).not.toContain('set-cookie');
  });

  it('takes the inquiry and answers without saying whether the address was known', async () => {
    const page = decode(await (await site(SITE_A, '/inquiry')).text());
    const fields: [string, string][] = [
      ['school_id', hidden(page, 'school_id')],
      ['notice_id', hidden(page, 'notice_id')],
      ['parent_name', PARENT],
      ['email', 'vera.e2e@example.test'],
      ['child_name', 'Lia'],
      ['birth_year', '2019'],
      ['grade', '2'],
      ['message', 'Is there a place in grade 2 next September?'],
      ['notice_read', 'yes'],
      ['website', ''],
    ];
    const first = await sendForm(fields);
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe(`http://${SITE_A}:53000/inquiry?result=sent`);
    const again = await sendForm(fields);
    expect(again.headers.get('location')).toBe(first.headers.get('location'));
    const thanks = decode(await (await site(SITE_A, '/inquiry?result=sent')).text());
    expect(thanks).toContain('The school has your inquiry and will answer by e-mail.');

    // A bot filling the hidden field gets the same answer, and nothing is stored.
    const bot = await sendForm([
      ...fields.slice(0, -1),
      ['website', 'http://spam.example'],
      ['parent_name', 'Bot (e2e test)'],
    ]);
    expect(bot.headers.get('location')).toBe(first.headers.get('location'));
    // Without confirming the notice, the family is asked to.
    const unread = await sendForm(fields.filter(([name]) => name !== 'notice_read'));
    expect(new URL(unread.headers.get('location')!).searchParams.get('problem')).toContain('privacy notice');
    // A form posted from anywhere else is refused.
    expect((await sendForm(fields, 'http://evil.example')).status).toBe(403);
  });
});

describe('inquiries in the portal', () => {
  it('lets the principal of School A see the inquiry, log a call and close it', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await (await principal.follow(`${APP}/`)).response.text()).toContain(
      'href="/admissions/inquiries"',
    );
    const list = decode(await (await principal.follow(`${APP}/admissions/inquiries`)).response.text());
    const start = list.indexOf(`<h2>${PARENT}</h2>`);
    expect(start).toBeGreaterThan(-1);
    const article = list.slice(list.lastIndexOf('<article', start), list.indexOf('</article>', start));
    expect(article).toContain('E-mail: vera.e2e@example.test');
    expect(article).toContain('Child: Lia, born 2019');
    expect(article).toContain('Is there a place in grade 2 next September?');
    expect(article).toContain('The family wrote again');
    expect(list).not.toContain('Bot (e2e test)');
    const inquiryId = /data-testid="inquiry-([0-9a-f-]{36})"/.exec(article)![1]!;

    const noted = await postForm(principal, '/admissions/inquiries/actions', [
      ['action', 'note'],
      ['inquiry_id', inquiryId],
      ['kind', 'call'],
      ['body', 'Called; invited to the open day.'],
    ]);
    expect(new URL(noted.headers.get('location')!).searchParams.get('done')).toBe('noted');
    const closed = await postForm(principal, '/admissions/inquiries/actions', [
      ['action', 'close'],
      ['inquiry_id', inquiryId],
      ['outcome', 'applied'],
    ]);
    expect(new URL(closed.headers.get('location')!).searchParams.get('done')).toBe('closed');
    const done = decode(
      await (await principal.follow(`${APP}/admissions/inquiries?status=closed`)).response.text(),
    );
    const after = done.slice(done.indexOf(`data-testid="inquiry-${inquiryId}"`));
    expect(after.slice(0, after.indexOf('</article>'))).toMatch(
      /Closed: Applied.*Call, Petar Nikolov, .*Called; invited/s,
    );
  });

  it('keeps the inquiry from the kitchen, School Life and another school, and refuses cross-site forms', async () => {
    for (const user of ['kitchen.a', 'schoollife', 'ceo']) {
      const browser = (await signIn(`${user}@pythagoras.test`, PASSWORD)).browser;
      const page = await (await browser.follow(`${APP}/admissions/inquiries`)).response.text();
      expect(page).toContain('data-testid="not-permitted"');
    }
    const otherSchool = (await signIn('principal.c@pythagoras.test', PASSWORD)).browser;
    expect(
      await (await otherSchool.follow(`${APP}/admissions/inquiries?status=all`)).response.text(),
    ).not.toContain(PARENT);
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const crossSite = await principal.request(`${APP}/admissions/inquiries/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.example' },
      body: new URLSearchParams([['action', 'close']]),
    });
    expect(crossSite.status).toBe(403);
  });
});
