import {
  type DietaryNeed,
  type DietaryReview,
  type KitchenCounts,
  type LunchMenus,
  type MenuDish,
  type StudentDietary,
} from '@pythagoras/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  BORIS,
  get,
  MILA,
  offeringsOf,
  payAndWait,
  placeOrder,
  post,
  secret,
  tokenFor,
} from './helpers';

// Lunch menus and dietary needs (M4.1) against the real stack. The School A
// kitchen publishes a menu with peanuts on a day Anna then books for Mila,
// whose life-threatening peanut allergy is in the seed; School Life must see
// the warning. Anna records a need for Boris, which School Life verifies.

const SCHOOLLIFE = 'c1000000-0000-7000-8000-000000000004';
const CEO = 'c1000000-0000-7000-8000-000000000001';

const tokens: Record<string, string> = {};
let day: string;
let sessionId: string;
let clubSessionId: string;
let schoolCSessionId: string;
let originalMenu: MenuDish[];
let auditor: Client;

const MENU: MenuDish[] = [
  { course: 'soup', name: 'Pumpkin soup (test)', allergens: ['celery'] },
  { course: 'dessert', name: 'Peanut flapjack (test)', allergens: ['peanuts', 'gluten'] },
];

async function send<T>(method: string, user: string, path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[user]}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
}
const putMenu = (user: string, session: string, dishes: unknown[]) =>
  send<{ dishes: MenuDish[] }>('PUT', user, `/school-life/sessions/${session}/menu`, { dishes });

/** Access-log rows since a moment, read as the CEO (audit.read) through the API role. */
async function accessLog(actor: string, resource: string, subject: string, since: Date): Promise<number> {
  await auditor.query('BEGIN');
  try {
    await auditor.query(`SELECT set_config('app.person_id', $1, true)`, [CEO]);
    const { rows } = await auditor.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.access_log
        WHERE actor_person_id = $1 AND resource = $2 AND subject_person_id = $3 AND occurred_at >= $4`,
      [actor, resource, subject, since],
    );
    return Number(rows[0]!.n);
  } finally {
    await auditor.query('ROLLBACK');
  }
}

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'schoollife', 'kitchen.a', 'ceo', 'teacher.b', 'principal.c']) {
    tokens[user] = await tokenFor(user);
  }
  auditor = new Client({
    host: 'postgres',
    database: 'pythagoras',
    user: 'pyth_api',
    password: secret('pg_api_password'),
  });
  await auditor.connect();

  const mila = await offeringsOf(tokens['anna.ivanova']!, MILA);
  const boris = await offeringsOf(tokens['anna.ivanova']!, BORIS);
  const free = mila.lunch.sessions.filter(
    (session) => !session.alreadyBooked && (session.available ?? 1) > 0,
  );
  const chosen = free[free.length - 1]!;
  day = chosen.serviceDate!;
  sessionId = chosen.id;
  originalMenu = chosen.menu;
  clubSessionId = mila.activity.sessions[0]!.id;
  schoolCSessionId = boris.lunch.sessions[0]!.id;
});

afterAll(async () => {
  // Put the seeded menu back.
  if (sessionId) await putMenu('schoollife', sessionId, originalMenu);
  await auditor?.end();
});

describe('lunch menus', () => {
  it('lets the School A kitchen publish a menu with allergens, which Anna sees when booking', async () => {
    const { status, body } = await putMenu('kitchen.a', sessionId, MENU);
    expect(status).toBe(200);
    expect(body.dishes).toEqual(MENU);

    const mila = await offeringsOf(tokens['anna.ivanova']!, MILA);
    expect(mila.lunch.sessions.find((session) => session.id === sessionId)!.menu).toEqual(MENU);
    expect(mila.activity.sessions.every((session) => session.menu.length === 0)).toBe(true);
  });

  it('shows staff the menus of their schools, and lets only those who may publish change them', async () => {
    const kitchen = (await get<LunchMenus>(`/school-life/menus?from=${day}&days=1`, tokens['kitchen.a']!))
      .body;
    expect(kitchen.schools.map((entry) => entry.school.name)).toEqual(['School A']);
    expect(kitchen.schools[0]!.canEdit).toBe(true);
    expect(kitchen.schools[0]!.days.find((entry) => entry.sessionId === sessionId)!.dishes).toEqual(MENU);

    const ceo = (await get<LunchMenus>(`/school-life/menus?from=${day}&days=1`, tokens.ceo!)).body;
    expect(ceo.schools.length).toBeGreaterThanOrEqual(3);
    expect(ceo.schools.every((entry) => !entry.canEdit)).toBe(true);

    expect((await get(`/school-life/menus`, tokens['anna.ivanova']!)).status).toBe(403);
  });

  it('refuses menus from people who may not publish them, for other schools and for clubs', async () => {
    // Published lunch days are visible to all staff, so this is a refusal, not "not found".
    expect((await putMenu('kitchen.a', schoolCSessionId, MENU)).status).toBe(403);
    expect((await putMenu('teacher.b', sessionId, MENU)).status).toBe(403);
    expect((await putMenu('ceo', sessionId, MENU)).status).toBe(403);
    expect((await putMenu('anna.ivanova', sessionId, MENU)).status).toBe(403);
    expect((await putMenu('schoollife', clubSessionId, MENU)).status).toBe(422);
    expect(
      (await putMenu('kitchen.a', sessionId, [{ course: 'main', name: 'Kiwi', allergens: ['kiwi'] }])).status,
    ).toBe(400);
    const mila = await offeringsOf(tokens['anna.ivanova']!, MILA);
    expect(mila.lunch.sessions.find((session) => session.id === sessionId)!.menu).toEqual(MENU);
  });
});

describe('the kitchen warning', () => {
  let counts: KitchenCounts;
  let since: Date;

  beforeAll(async () => {
    const mila = await offeringsOf(tokens['anna.ivanova']!, MILA);
    await payAndWait(
      tokens['anna.ivanova']!,
      await placeOrder(tokens['anna.ivanova']!, [
        { studentId: MILA, offeringId: mila.lunch.id, sessionIds: [sessionId] },
      ]),
    );
    since = new Date(Date.now() - 1000);
    counts = (await get<KitchenCounts>(`/school-life/kitchen?from=${day}&days=1`, tokens.schoollife!)).body;
  });

  it("warns School Life that Mila's peanut allergy is on her lunch that day, before anything else", () => {
    const schoolA = counts.schools.find((entry) => entry.school.name === 'School A')!.days[0]!;
    expect(schoolA.menu).toEqual(expect.arrayContaining(MENU));
    expect(schoolA.dietary[0]).toMatchObject({
      studentName: 'Mila Ivanova',
      severity: 'life_threatening',
      allergens: ['peanuts'],
      menuConflicts: [{ dish: 'Peanut flapjack (test)', allergens: ['peanuts'] }],
    });
  });

  it('writes the dietary read to the access log, per child', async () => {
    expect(
      await accessLog(SCHOOLLIFE, 'sensitive.dietary_requirement:kitchen', MILA, since),
    ).toBeGreaterThanOrEqual(1);
  });

  it('gives the CEO the menu and counts but no dietary needs, and logs no read', async () => {
    const ceo = (await get<KitchenCounts>(`/school-life/kitchen?from=${day}&days=1`, tokens.ceo!)).body;
    const schoolA = ceo.schools.find((entry) => entry.school.name === 'School A')!.days[0]!;
    expect(schoolA.menu).toEqual(expect.arrayContaining(MENU));
    expect(schoolA.dietary).toEqual([]);
    expect(await accessLog(CEO, 'sensitive.dietary_requirement:kitchen', MILA, since)).toBe(0);
  });
});

describe("a child's dietary needs", () => {
  let needId: string;

  it("lets Anna record a need for Boris, unverified, and see it with Mila's untouched", async () => {
    const added = await post<DietaryNeed>(tokens['anna.ivanova']!, `/students/${BORIS}/dietary`, {
      kind: 'allergy',
      description: 'Sesame (integration test)',
      severity: 'severe',
      allergens: ['sesame', 'sesame'],
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ allergens: ['sesame'], verified: false, verifiedAt: null });
    needId = added.body.id;

    const boris = (await get<StudentDietary>(`/students/${BORIS}/dietary`, tokens['anna.ivanova']!)).body;
    expect(boris.canChange).toBe(true);
    expect(boris.needs).toContainEqual(
      expect.objectContaining({ id: needId, verified: false, canWithdraw: true }),
    );
  });

  it('refuses unknown allergens and other families', async () => {
    expect(
      (
        await post(tokens['anna.ivanova']!, `/students/${BORIS}/dietary`, {
          kind: 'allergy',
          description: 'x',
          allergens: ['kiwi'],
        })
      ).status,
    ).toBe(400);
    const hristo = await tokenFor('hristo.georgiev');
    expect((await get(`/students/${BORIS}/dietary`, hristo)).status).toBe(404);
    expect(
      (
        await post(hristo, `/students/${BORIS}/dietary`, {
          kind: 'other',
          description: 'not mine',
          allergens: [],
        })
      ).status,
    ).toBe(403);
  });

  it('shows the need to School Life to verify, to the School C principal to read, and to nobody else', async () => {
    const review = (await get<DietaryReview>('/school-life/dietary', tokens.schoollife!)).body;
    const schoolC = review.schools.find((entry) => entry.school.name === 'School C')!;
    expect(schoolC.canVerify).toBe(true);
    expect(schoolC.needs).toContainEqual(
      expect.objectContaining({ id: needId, studentName: 'Boris Ivanov', verified: false }),
    );
    const principal = (await get<DietaryReview>('/school-life/dietary', tokens['principal.c']!)).body;
    expect(principal.schools.map((entry) => entry.school.name)).toEqual(['School C']);
    expect(principal.schools[0]!.canVerify).toBe(false);
    expect(principal.schools[0]!.needs.map((need) => need.id)).toContain(needId);
    expect((await get('/school-life/dietary', tokens['kitchen.a']!)).status).toBe(403);
    expect((await get('/school-life/dietary', tokens.ceo!)).status).toBe(403);
    expect((await get('/school-life/dietary', tokens['anna.ivanova']!)).status).toBe(403);
  });

  it('lets only School Life verify, and Anna cannot verify her own entry', async () => {
    expect((await post(tokens['anna.ivanova']!, `/school-life/dietary/${needId}/verify`)).status).toBe(403);
    expect((await post(tokens['kitchen.a']!, `/school-life/dietary/${needId}/verify`)).status).toBe(404);
    const verified = await post<DietaryNeed>(tokens.schoollife!, `/school-life/dietary/${needId}/verify`);
    expect(verified.status).toBe(200);
    expect(verified.body.verified).toBe(true);
    expect(verified.body.verifiedAt).not.toBeNull();
  });

  it('does not let Anna delete a verified need, and her change makes it unverified again', async () => {
    expect((await send('DELETE', 'anna.ivanova', `/students/${BORIS}/dietary/${needId}`)).status).toBe(409);
    const changed = await send<DietaryNeed>('PATCH', 'anna.ivanova', `/students/${BORIS}/dietary/${needId}`, {
      kind: 'allergy',
      description: 'Sesame (integration test)',
      severity: 'moderate',
      allergens: ['sesame'],
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ severity: 'moderate', verified: false });
  });

  it("logs Anna's and School Life's reads of Boris's needs, one row per read", async () => {
    const ANNA = 'c1000000-0000-7000-8000-000000000020';
    const all = new Date(0);
    const review = await accessLog(SCHOOLLIFE, 'sensitive.dietary_requirement:review', BORIS, all);
    const family = await accessLog(ANNA, 'sensitive.dietary_requirement:family', BORIS, all);
    await get('/school-life/dietary', tokens.schoollife!);
    await get(`/students/${BORIS}/dietary`, tokens['anna.ivanova']!);
    expect(await accessLog(SCHOOLLIFE, 'sensitive.dietary_requirement:review', BORIS, all)).toBe(review + 1);
    expect(await accessLog(ANNA, 'sensitive.dietary_requirement:family', BORIS, all)).toBe(family + 1);
  });

  it('lets Anna take back the now unverified need she recorded', async () => {
    expect((await send('DELETE', 'anna.ivanova', `/students/${BORIS}/dietary/${needId}`)).status).toBe(204);
    const boris = (await get<StudentDietary>(`/students/${BORIS}/dietary`, tokens['anna.ivanova']!)).body;
    expect(boris.needs.map((need) => need.id)).not.toContain(needId);
  });

  it('ends a need from tomorrow, keeping it for today', async () => {
    const added = await post<DietaryNeed>(tokens.schoollife!, `/students/${BORIS}/dietary`, {
      kind: 'vegetarian',
      description: 'Vegetarian (integration test)',
      allergens: [],
    });
    expect(added.status).toBe(201);
    expect(added.body.verified).toBe(true);
    const done = await post<DietaryNeed>(
      tokens['anna.ivanova']!,
      `/students/${BORIS}/dietary/${added.body.id}/end`,
    );
    expect(done.status).toBe(200);
    expect(done.body.validUntil).not.toBeNull();
    expect(done.body.verified).toBe(false);
    expect(
      (await post(tokens['anna.ivanova']!, `/students/${BORIS}/dietary/${added.body.id}/end`)).status,
    ).toBe(404);
  });
});
