import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// The accounting export through the web app (M7.4): group finance sees a
// company's summary for a period, with the warning that the layout is not yet
// an import format, and downloads the CSV; a principal may not.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const today = new Date().toISOString().slice(0, 10);

const decode = (value: string) =>
  value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());

describe('the accounting export page', () => {
  it('shows group finance a company’s period and gives the CSV', async () => {
    const finance = (await signIn('finance@pythagoras.test', PASSWORD)).browser;
    expect(await open(finance, '/')).toContain('href="/accounting"');
    const first = await open(finance, '/accounting');
    expect(first).toContain('It is not yet an import format');
    const companyId = /<option value="([0-9a-f-]{36})"[^>]*>Testing Company \(/.exec(first)![1]!;

    const page = await open(finance, `/accounting?companyId=${companyId}&from=${today}&to=${today}`);
    expect(page).toContain(`Testing Company, ${today} to ${today}:`);
    const href = /data-testid="download" href="([^"]+)"|href="([^"]+)" data-testid="download"/.exec(page)!;
    const path = (href[1] ?? href[2])!;
    expect(path).toBe(`/accounting/export?companyId=${companyId}&from=${today}&to=${today}`);
    const file = await finance.request(`${APP}${path}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="ledger-/);
    expect((await file.text()).split('\r\n')[0]).toMatch(/^date,entry,mode,order,/);

    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await open(principal, '/accounting')).toContain('data-testid="not-permitted"');
    expect((await principal.request(`${APP}${path}`)).status).toBe(403);
  });
});
