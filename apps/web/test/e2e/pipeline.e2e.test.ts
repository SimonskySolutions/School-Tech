import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Admissions in numbers through the web app (M5.5): the principal of School A
// sees the seeded intake and inquiries with what to follow up; the CEO sees
// every school's numbers from the reports section, with no names; the
// kitchen sees nothing.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const INTAKE = 'db000000-0000-7000-8000-0000000000a1';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());

describe('admissions in numbers', () => {
  it('shows the principal the intake, the inquiries and what to follow up', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await open(principal, '/')).toContain('href="/admissions/pipeline"');
    const page = await open(principal, '/admissions/pipeline');
    const row = page.slice(page.indexOf(`data-testid="pipeline-intake-${INTAKE}"`));
    expect(row.slice(0, row.indexOf('</tr>'))).toMatch(/School A, grade 1, 2027\/28<\/td><td[^>]*>20<\/td>/);
    expect(page).toContain('data-testid="pipeline-inquiries-School A"');
    expect(page).toContain('data-testid="follow-ups"');
  });

  it('shows the CEO every school’s numbers without names, and the kitchen nothing', async () => {
    const ceo = (await signIn('ceo@pythagoras.test', PASSWORD)).browser;
    expect(await open(ceo, '/')).toContain('data-testid="admissions-report-link"');
    const page = await open(ceo, '/admissions/pipeline');
    expect(page).toContain(`data-testid="pipeline-intake-${INTAKE}"`);
    expect(page).not.toContain('data-testid="follow-ups"');
    expect(page).not.toContain('Lora');
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    expect(await open(kitchen, '/admissions/pipeline')).toContain('data-testid="not-permitted"');
  });
});
