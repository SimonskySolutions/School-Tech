import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Approvals through the web app (M6.5): the principal of School A files a
// policy and asks for it to be approved by the principal, then the CEO; each
// approves from "Approvals"; the kitchen sees it approved.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const TITLE = 'Anti-bullying policy (e2e approvals)';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const send = (browser: Browser, path: string, entries: [string, string | File][]) => {
  const body = new FormData();
  for (const [name, value] of entries) body.append(name, value);
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { origin: APP },
    body,
    redirect: 'manual',
  });
};
const notice = (response: Response, name: string) =>
  new URL(response.headers.get('location')!).searchParams.get(name);
const after = (page: string, marker: string) => page.slice(page.indexOf(marker));

describe('approvals', () => {
  it('go from the principal to the CEO, and the staff see the policy approved', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const documents = `/schools/${SCHOOL_A}/documents`;
    expect(
      notice(
        await send(principal, `${documents}/actions`, [
          ['action', 'file'],
          ['title', TITLE],
          ['category', 'policy'],
          ['attached', 'school'],
          ['for_all_staff', 'yes'],
          [
            'file',
            new File(['%PDF-1.7\n% policy (synthetic)\n'], 'anti-bullying.pdf', { type: 'application/pdf' }),
          ],
        ]),
        'done',
      ),
    ).toBe('filed');
    const filed = after(await open(principal, documents), `<strong>${TITLE}</strong>`);
    const versionId = /name="version_id" value="([0-9a-f-]{36})"/.exec(filed)![1]!;
    const ask = (steps: [string, string][]) =>
      send(principal, '/documents/approvals/actions', [
        ['action', 'ask'],
        ['version_id', versionId],
        ['back', documents],
        ...steps,
      ]);
    expect(
      notice(
        await ask([
          ['step_1', 'principal'],
          ['step_2', 'principal'],
        ]),
        'error',
      ),
    ).toBe('each approver once');
    expect(
      notice(
        await ask([
          ['step_1', 'principal'],
          ['step_2', 'group_ceo'],
          ['step_3', ''],
        ]),
        'done',
      ),
    ).toBe('asked');
    expect(after(await open(principal, documents), `<strong>${TITLE}</strong>`)).toContain(
      'Approval: waiting for approval: the principal (waiting), then the CEO (waiting)',
    );

    const decide = async (browser: Browser, fields: [string, string][]) => {
      const page = await open(browser, '/documents/approvals');
      const entry = page.slice(
        page.lastIndexOf('data-testid="waiting-', page.indexOf(`<strong>${TITLE}</strong>`)),
      );
      const stepId = /^data-testid="waiting-([0-9a-f-]{36})"/.exec(entry)![1]!;
      return send(browser, '/documents/approvals/actions', [
        ['action', 'decide'],
        ['step_id', stepId],
        ['back', '/documents/approvals'],
        ...fields,
      ]);
    };
    expect(await open(principal, '/')).toContain('href="/documents/approvals"');
    expect(notice(await decide(principal, [['decision', 'approved']]), 'done')).toBe('pending');

    const ceo = (await signIn('ceo@pythagoras.test', PASSWORD)).browser;
    expect(await open(ceo, '/documents/approvals')).toContain('step 2 of 2, as the CEO');
    expect(
      notice(
        await decide(ceo, [
          ['decision', 'rejected'],
          ['note', ''],
        ]),
        'error',
      ),
    ).toBe('say why it is rejected');
    expect(notice(await decide(ceo, [['decision', 'approved']]), 'done')).toBe('approved');
    expect(await open(ceo, '/documents/approvals')).not.toContain(TITLE);

    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const seen = after(await open(kitchen, documents), `<strong>${TITLE}</strong>`);
    expect(seen).toContain('Approval: approved: the principal (approved by Petar Nikolov');
    expect(seen).toContain('then the CEO (approved by Elena Petrova');
    expect(seen.slice(0, seen.indexOf('</li>'))).not.toContain('Ask for approval');
  });
});
