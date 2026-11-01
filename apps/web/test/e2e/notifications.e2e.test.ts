import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// The Notifications page (M7.2, ADR 0031): the kitchen of School A sees which
// e-mails it receives, turns task messages off and on again, and cannot turn
// payment confirmations off.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();

const decode = (value: string) =>
  value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const choose = (browser: Browser, kind: string, enabled: string) =>
  browser.request(`${APP}/notifications/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams({ kind, enabled }),
  });
const notice = (response: Response, name: string) =>
  new URL(response.headers.get('location')!).searchParams.get(name);
const entry = (page: string, code: string) => {
  const start = page.indexOf(`data-testid="kind-${code}"`);
  return page.slice(start, page.indexOf('</li>', start));
};

describe('notifications', () => {
  it('let a person turn off what is not essential', async () => {
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    expect(await open(kitchen, '/')).toContain('href="/notifications"');
    const page = await open(kitchen, '/notifications');
    expect(entry(page, 'order.paid')).toContain('always sent');
    expect(entry(page, 'task.assigned')).toContain(' · on ');

    expect(notice(await choose(kitchen, 'task.assigned', 'false'), 'done')).toBe('off');
    expect(entry(await open(kitchen, '/notifications'), 'task.assigned')).toContain(' · off ');
    expect(notice(await choose(kitchen, 'order.paid', 'false'), 'error')).toBe('this message is always sent');
    expect(notice(await choose(kitchen, 'task.assigned', 'true'), 'done')).toBe('on');
    expect(entry(await open(kitchen, '/notifications'), 'task.assigned')).toContain(' · on ');
  });
});
