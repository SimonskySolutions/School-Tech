import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// A day's operation through the web app (M4.8). Anna buys Mila lunch on a
// club Wednesday inside the bus term and a size-116 polo shirt, pays, and
// writes to the school. School Life opens School A's day: the meals with
// Mila's allergy as an alert, the chess club, the bus, the shirt to hand over
// and the request waiting. The principal hands the shirt over and the day
// shows one item fewer. Other roles see only their parts, or nothing.
// Nothing here takes a place another test needs: the bus seat and the club
// are left to their own tests, which may run before or after this one.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const MILA = 'c1000000-0000-7000-8000-000000000030';
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const POLO = 'd2000000-0000-7000-8000-0000000000a9';
const SIZE_116 = 'd6000000-0000-7000-8000-0000000000a1';
const SUBJECT = 'Mila brings a packed snack on Wednesday (e2e test)';
const MILA_ALLERGY = 'Mila Ivanova (3A): Allergy (Life-threatening), Peanuts (synthetic example)';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");

async function postForm(browser: Browser, path: string, fields: [string, string][]) {
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
}

const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());

const section = (page: string, testId: string) => {
  const start = page.indexOf(`data-testid="${testId}"`);
  expect(start).toBeGreaterThan(-1);
  return page.slice(start, page.indexOf('</section>', start));
};

const count = (text: string, pattern: RegExp) => Number(pattern.exec(text)![1]);

/** The last Wednesday Mila can still have lunch on: a chess day, late enough to fall in the bus term. */
function lunchWednesday(services: string): { date: string; value: string } {
  const days = [...services.matchAll(/data-testid="lunch-day-(\d{4}-\d{2}-\d{2})"[^>]*>(.*?)<\/li>/gs)]
    .map(([, date, html]) => ({ date: date!, input: /<input[^>]*name="lunch"[^>]*>/.exec(html!)?.[0] ?? '' }))
    .filter(
      ({ date, input }) =>
        input.includes(MILA) && !/\sdisabled/.test(input) && new Date(date).getUTCDay() === 3,
    );
  const day = days.at(-1)!;
  return { date: day.date, value: decode(/value="([^"]+)"/.exec(day.input)![1]!) };
}

describe('a day at School A', () => {
  let date: string;
  let toHandOver: number;

  it('lets Anna buy lunch and a shirt, pay, and write to the school', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const lunch = lunchWednesday(await open(anna, '/services'));
    date = lunch.date;

    const placed = await postForm(anna, '/checkout', [
      ['idempotency_key', crypto.randomUUID()],
      ['lunch', lunch.value],
      ['uniform', `${MILA}|${POLO}|${SIZE_116}|1`],
    ]);
    expect(placed.status).toBe(303);
    const checkoutUrl = placed.headers.get('location')!;
    const provider = await (await anna.follow(checkoutUrl)).response.text();
    const payAction = decode(/<form method="post" action="([^"]+\/succeed)"/.exec(provider)![1]!);
    const paid = await anna.request(new URL(payAction, checkoutUrl).toString(), { method: 'POST' });
    const orderUrl = new URL(paid.headers.get('location')!, APP).toString();
    let order = '';
    for (let tries = 0; tries < 40; tries += 1) {
      order = decode(await (await anna.follow(orderUrl)).response.text());
      if (order.includes('data-status="paid"')) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(order).toContain('data-status="paid"');
    expect(order).toContain('School polo shirt, School A, 116, Navy');

    const sent = await postForm(anna, `/children/${MILA}/requests/actions`, [
      ['action', 'open'],
      ['school_id', SCHOOL_A],
      ['kind', 'dietary'],
      ['subject', SUBJECT],
      ['message', 'She will bring fruit from home for the afternoon club.'],
    ]);
    expect(sent.status).toBe(303);
    expect(new URL(sent.headers.get('location')!, APP).searchParams.get('done')).toBeTruthy();
  });

  it('shows School Life everything on the day, linking to where the work is done', async () => {
    const schoolLife = (await signIn('schoollife@pythagoras.test', PASSWORD)).browser;
    expect(await open(schoolLife, '/')).toContain('href="/school-life/day"');
    const page = await open(schoolLife, `/school-life/day?schoolId=${SCHOOL_A}&date=${date}`);
    expect(page).toMatch(/<h1>School A: Wednesday \d+ \w+<\/h1>/);
    expect(page).toContain(`href="/school-life/day?schoolId=${SCHOOL_A}`);

    const lunch = section(page, 'day-lunch');
    expect(count(lunch, /(\d+) meals? paid/)).toBeGreaterThan(0);
    const at = lunch.indexOf(MILA_ALLERGY);
    expect(at).toBeGreaterThan(-1);
    expect(lunch.slice(lunch.lastIndexOf('<li', at), at)).toContain('role="alert"');
    expect(lunch).toContain(`href="/school-life/lunch?schoolId=${SCHOOL_A}&date=${date}"`);
    expect(lunch).toContain(`href="/school-life/kitchen?from=${date}&days=1"`);

    expect(section(page, 'day-sessions')).toMatch(/Chess club, School A, Wed \d+ \w+, 14:00–15:00, Room 12/);
    expect(section(page, 'day-transport')).toMatch(
      /School bus, route 1, School A: \d+ of 20 seats taken, first pick-up 07:20/,
    );

    const uniforms = section(page, 'day-uniforms');
    toHandOver = count(uniforms, /(\d+) items? paid and waiting to be handed over/);
    expect(toHandOver).toBeGreaterThan(0);
    expect(uniforms).toContain(`href="/schools/${SCHOOL_A}/uniforms"`);
    expect(count(section(page, 'day-requests'), /(\d+) waiting for an answer/)).toBeGreaterThan(0);
    expect(section(page, 'day-verify')).toContain('href="/school-life/dietary"');
  });

  it('counts one item fewer once the principal hands the shirt over', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const uniforms = await open(principal, `/schools/${SCHOOL_A}/uniforms`);
    const waiting = section(uniforms, 'awaiting-handover');
    const at = waiting.indexOf('Mila Ivanova, 3A: 1 × School polo shirt, School A, 116');
    expect(at).toBeGreaterThan(-1);
    const reservationId = /name="reservation_id" value="([^"]+)"/.exec(waiting.slice(at))![1]!;
    const handed = await postForm(principal, `/schools/${SCHOOL_A}/uniforms/actions`, [
      ['action', 'hand-over'],
      ['reservation_id', reservationId],
    ]);
    expect(handed.status).toBe(303);

    const schoolLife = (await signIn('schoollife@pythagoras.test', PASSWORD)).browser;
    const page = await open(schoolLife, `/school-life/day?schoolId=${SCHOOL_A}&date=${date}`);
    expect(count(section(page, 'day-uniforms'), /(\d+) items? paid and waiting/)).toBe(toHandOver - 1);
  });

  it('shows the kitchen its lunch without requests, and others nothing', async () => {
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const page = await open(kitchen, `/school-life/day?date=${date}`);
    expect(page).toContain('School A: Wednesday');
    expect(page).toContain('Mila Ivanova: Allergy (Life-threatening)');
    expect(page).not.toContain('data-testid="day-requests"');
    expect(page).not.toContain('data-testid="day-verify"');

    const principalC = (await signIn('principal.c@pythagoras.test', PASSWORD)).browser;
    expect(await open(principalC, `/school-life/day?schoolId=${SCHOOL_A}`)).toContain(
      'data-testid="not-permitted"',
    );
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    expect(await open(anna, '/school-life/day')).toContain('data-testid="not-permitted"');
  });
});
