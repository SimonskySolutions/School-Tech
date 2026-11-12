import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Parent requests through the web app (M4.7): Anna writes to School A about
// Mila, School Life answers on its page, Anna reads the answer and closes it.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const MILA = 'c1000000-0000-7000-8000-000000000030';
const SUBJECT = 'Mila leaves early on Thursday (e2e test)';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");

async function postForm(browser: Browser, path: string, fields: [string, string][], origin = APP) {
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams(fields),
  });
}

async function followBack(browser: Browser, response: Response): Promise<string> {
  expect(response.status).toBe(303);
  return decode(
    await (await browser.follow(new URL(response.headers.get('location')!, APP).toString())).response.text(),
  );
}

/** The article of one request on a page, found by its subject. */
function article(page: string, subject: string): { id: string; html: string } {
  const at = page.indexOf(subject);
  expect(at).toBeGreaterThan(-1);
  const start = page.lastIndexOf('<article', at);
  const html = page.slice(start, page.indexOf('</article>', at));
  return { id: /data-testid="request-([0-9a-f-]{36})"/.exec(html)![1]!, html };
}

describe('messages between a family and the school', () => {
  it('lets Anna write, School Life answer, and Anna close it', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const page = decode(await (await anna.follow(`${APP}/children/${MILA}/requests`)).response.text());
    expect(page).toContain('Messages to the school: Mila Ivanova');
    expect(page).toContain('Who collects: Grandmother collects Mila on Friday (synthetic)');
    const schoolId = /name="school_id" value="([^"]+)"/.exec(page)![1]!;

    const sent = await followBack(
      anna,
      await postForm(anna, `/children/${MILA}/requests/actions`, [
        ['action', 'open'],
        ['school_id', schoolId],
        ['kind', 'collection'],
        ['subject', SUBJECT],
        ['message', 'Her father collects her at 13:00 for a doctor’s appointment.'],
      ]),
    );
    expect(sent).toContain('Sent to the school.');
    expect(article(sent, SUBJECT).html).toContain('School A · Waiting for the school');

    const schoolLife = (await signIn('schoollife@pythagoras.test', PASSWORD)).browser;
    const list = decode(await (await schoolLife.follow(`${APP}/school-life/requests`)).response.text());
    const { id, html } = article(list, SUBJECT);
    expect(html).toContain('Mila Ivanova, 3A · School A · from Anna Ivanova · Waiting for the school');
    expect(html).toContain('Her father collects her at 13:00');
    const answered = await followBack(
      schoolLife,
      await postForm(schoolLife, '/school-life/requests/actions', [
        ['action', 'reply'],
        ['request_id', id],
        ['message', 'Noted; reception will have her ready at 13:00.'],
      ]),
    );
    expect(answered).toContain('Message sent.');
    expect(article(answered, SUBJECT).html).toContain('Answered');

    const back = decode(await (await anna.follow(`${APP}/children/${MILA}/requests`)).response.text());
    const mine = article(back, SUBJECT).html;
    expect(mine).toContain('School A · Answered');
    expect(mine).toContain('Noted; reception will have her ready at 13:00.');
    const closed = await followBack(
      anna,
      await postForm(anna, `/children/${MILA}/requests/actions`, [
        ['action', 'close'],
        ['request_id', id],
      ]),
    );
    expect(closed).toContain('Closed.');
    expect(article(closed, SUBJECT).html).not.toContain('name="message"');
  });

  it('keeps other parents, the kitchen and cross-site forms out', async () => {
    const hristo = (await signIn('hristo.georgiev@pythagoras.test', PASSWORD)).browser;
    expect(await (await hristo.follow(`${APP}/children/${MILA}/requests`)).response.text()).toContain(
      'data-testid="not-permitted"',
    );
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    expect(await (await kitchen.follow(`${APP}/school-life/requests`)).response.text()).toContain(
      'data-testid="not-permitted"',
    );
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const evil = await postForm(
      anna,
      `/children/${MILA}/requests/actions`,
      [['action', 'open']],
      'http://evil.test',
    );
    expect(evil.status).toBe(403);
  });
});
