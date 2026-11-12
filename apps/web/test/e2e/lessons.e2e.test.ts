import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Individual lessons through the web app (M4.3): Anna buys the seeded piano
// package for Mila, pays on the development provider's page, books a time on
// Mila's lessons page and cancels it; staff see the teacher, the room and the
// lesson times and add a room.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const MILA = 'c1000000-0000-7000-8000-000000000030';
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const PIANO = 'd2000000-0000-7000-8000-0000000000a6';

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

describe('lessons for a family', () => {
  it('lets Anna buy the piano package for Mila, book a time and cancel it', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const services = decode(await (await anna.follow(`${APP}/services`)).response.text());
    expect(services).toContain(`name="package" value="${MILA}|${PIANO}"`);
    expect(services).toContain('for 5 lessons');

    const placed = await postForm(anna, '/checkout', [
      ['idempotency_key', crypto.randomUUID()],
      ['package', `${MILA}|${PIANO}`],
    ]);
    expect(placed.status).toBe(303);
    const checkoutUrl = placed.headers.get('location')!;
    const provider = await (await anna.follow(checkoutUrl)).response.text();
    const payAction = decode(/<form method="post" action="([^"]+\/succeed)"/.exec(provider)![1]!);
    const paid = await anna.request(new URL(payAction, checkoutUrl).toString(), { method: 'POST' });
    const orderUrl = new URL(paid.headers.get('location')!, APP).toString();
    for (let tries = 0; tries < 40; tries += 1) {
      if ((await (await anna.follow(orderUrl)).response.text()).includes('data-status="paid"')) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const page = decode(await (await anna.follow(`${APP}/children/${MILA}/lessons`)).response.text());
    expect(page).toContain('Lessons: Mila Ivanova');
    expect(page).toMatch(/Piano lessons, School A \(5 lessons\): 5 of 5 lessons left/);
    const slots = [
      ...page.matchAll(/name="session_id" value="([^"]+)"[\s\S]*?name="package_id" value="([^"]+)"/g),
    ];
    expect(slots.length).toBeGreaterThan(0);
    const [, sessionId, packageId] = slots[slots.length - 1]!;

    const booked = await followBack(
      anna,
      await postForm(anna, `/children/${MILA}/lessons/actions`, [
        ['action', 'book'],
        ['session_id', sessionId!],
        ['package_id', packageId!],
      ]),
    );
    expect(booked).toContain('Lesson booked.');
    expect(booked).toMatch(/: 4 of 5 lessons left/);
    expect(booked).toContain('Ms Elena Georgieva (piano), Music room');
    expect(booked).toContain('Cancel (the lesson goes back to the package)');

    const bookingId = /name="booking_id" value="([^"]+)"/.exec(booked)![1]!;
    const cancelled = await followBack(
      anna,
      await postForm(anna, `/children/${MILA}/lessons/actions`, [
        ['action', 'cancel'],
        ['booking_id', bookingId],
      ]),
    );
    expect(cancelled).toContain('Lesson cancelled. It is back in the package.');
    expect(cancelled).toMatch(/: 5 of 5 lessons left/);
  });

  it('keeps other parents out and refuses forms from another site', async () => {
    const hristo = (await signIn('hristo.georgiev@pythagoras.test', PASSWORD)).browser;
    const refused = await (await hristo.follow(`${APP}/children/${MILA}/lessons`)).response.text();
    expect(refused).toContain('data-testid="not-permitted"');
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const evil = await postForm(
      anna,
      `/children/${MILA}/lessons/actions`,
      [['action', 'book']],
      'http://evil.test',
    );
    expect(evil.status).toBe(403);
  });
});

describe('lessons for staff', () => {
  it('shows School Life the teacher, the room, their hours and the lesson times', async () => {
    const schoolLife = (await signIn('schoollife@pythagoras.test', PASSWORD)).browser;
    const home = await (await schoolLife.follow(`${APP}/`)).response.text();
    expect(home).toContain(`href="/schools/${SCHOOL_A}/lessons"`);
    const page = decode(
      await (await schoolLife.follow(`${APP}/schools/${SCHOOL_A}/lessons`)).response.text(),
    );
    expect(page).toContain('Lessons at School A');
    expect(page).toContain('Ms Elena Georgieva (piano)');
    expect(page).toContain('Tuesday 14:00–17:00');
    expect(page).toContain('Music room');
    expect(page).toContain('data-testid="create-slots"');
  });

  it('lets the principal add a room, and explains a wrong lesson length', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const added = await followBack(
      principal,
      await postForm(principal, `/schools/${SCHOOL_A}/lessons/actions`, [
        ['action', 'add-resource'],
        ['kind', 'room'],
        ['display_name', 'Art room (e2e test)'],
      ]),
    );
    expect(added).toContain('Added.');
    expect(added).toContain('Art room (e2e test)');

    const wrong = await postForm(principal, `/schools/${SCHOOL_A}/lessons/actions`, [
      ['action', 'create-slots'],
      ['offering_id', PIANO],
      ['teacher_id', PIANO],
      ['room_id', PIANO],
      ['from', '2026-11-02'],
      ['to', '2026-11-09'],
      ['minutes', '5'],
    ]);
    expect(new URL(wrong.headers.get('location')!, APP).searchParams.get('error')).toBe(
      'a lesson lasts 15 to 240 minutes',
    );
  });

  it('keeps a teacher at another school out', async () => {
    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    const page = await (await teacher.follow(`${APP}/schools/${SCHOOL_A}/lessons`)).response.text();
    expect(page).toContain('data-testid="not-permitted"');
  });
});
