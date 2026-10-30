import {
  type AddGuardianResponse,
  type CheckoutGroupView,
  type CheckoutResponse,
  type CreatedAccountResponse,
  type MeResponse,
  type StudentList,
} from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, finishFirstSignIn, get, MILA, offeringsOf, post, tokenFor } from './helpers';

// Students and families at a new school (M3.3), against the real stack. The
// group administrator opens School T, billed by its own company; School T's
// new principal signs in, enrols Anna's third child and links Anna, who
// already has children at School A and School C. Anna then buys lunch at two
// schools in one basket and gets one order per company. Test data uses the
// "test-" prefix; scripts/db-reset-test-data.sh removes it before each run.

const LUNCH = 'd1000000-0000-7000-8000-000000000001';
const run = Date.now().toString(36);
const tokens: Record<string, string> = {};
let schoolId: string;
let companyName: string;
let kalinaId: string;
let annaId: string;

function nextMonday(): string {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7));
  return day.toISOString().slice(0, 10);
}

beforeAll(async () => {
  for (const user of ['admin', 'anna.ivanova', 'principal.a']) tokens[user] = await tokenFor(user);
  const admin = tokens.admin!;
  annaId = (await get<MeResponse>('/me', tokens['anna.ivanova']!)).body.person.id;

  companyName = `Test company ${run}`;
  const company = await post<{ id: string }>(admin, '/admin/billing-entities', {
    legalName: companyName,
    registrationNumber: String(Date.now()).slice(-9),
  });
  schoolId = (
    await post<{ id: string }>(admin, '/admin/schools', {
      code: `test-${run}-fam`,
      name: `School T ${run}`,
      kind: 'school',
      timeZone: 'Europe/Sofia',
      billingEntityId: company.body.id,
    })
  ).body.id;
  const lunch = await post<{ offeringId: string }>(admin, `/admin/schools/${schoolId}/offerings`, {
    serviceDefinitionId: LUNCH,
    name: `Lunch at School T ${run}`,
    unitAmountMinor: 520,
    priceUnit: 'per_day',
  });
  const monday = nextMonday();
  await post(admin, `/admin/schools/${schoolId}/sessions`, {
    offeringId: lunch.body.offeringId,
    capacity: 50,
    schedule: { type: 'school_days', from: monday, to: monday },
  });
  const principal = await post<{ personId: string }>(admin, `/admin/schools/${schoolId}/staff`, {
    givenName: 'Tanya',
    familyName: 'Principal',
    email: `test-${run}-principal@pythagoras.test`,
    roleCode: 'principal',
  });
  expect((await post(admin, `/admin/schools/${schoolId}/activate`)).status).toBe(200);
  const account = await post<CreatedAccountResponse>(
    admin,
    `/admin/people/${principal.body.personId}/account`,
  );
  tokens.principalT = await finishFirstSignIn(account.body.username, `Principal-${run}-Passw0rd`);
});

describe("School T's principal enrols a child and records the family", () => {
  it('starts with no students', async () => {
    const { status, body } = await get<StudentList>(`/schools/${schoolId}/students`, tokens.principalT!);
    expect(status).toBe(200);
    expect(body.students).toEqual([]);
  });

  it("enrols Anna's third child", async () => {
    const { status, body } = await post<{ studentId: string }>(
      tokens.principalT!,
      `/schools/${schoolId}/students`,
      {
        givenName: 'Kalina',
        familyName: 'Ivanova',
        academicYear: '2026/2027',
        gradeLevel: '1',
        classLabel: '1A',
        startDate: '2026-09-15',
      },
    );
    expect(status).toBe(201);
    kalinaId = body.studentId;
  });

  it('links Anna as the existing parent she is, not as a second Anna', async () => {
    const { status, body } = await post<AddGuardianResponse>(
      tokens.principalT!,
      `/schools/${schoolId}/students/${kalinaId}/guardians`,
      { email: 'Anna.Ivanova@pythagoras.test', relationship: 'mother' },
    );
    expect(status).toBe(201);
    expect(body).toEqual({ guardianPersonId: annaId, existing: true });
    const again = await post(tokens.principalT!, `/schools/${schoolId}/students/${kalinaId}/guardians`, {
      email: 'anna.ivanova@pythagoras.test',
      relationship: 'mother',
    });
    expect(again.status).toBe(409);
  });

  it('registers a guardian who is new to the group, and needs their names to do so', async () => {
    const email = `test-${run}-father@pythagoras.test`;
    const path = `/schools/${schoolId}/students/${kalinaId}/guardians`;
    expect((await post(tokens.principalT!, path, { email, relationship: 'father' })).status).toBe(422);
    const { status, body } = await post<AddGuardianResponse>(tokens.principalT!, path, {
      email,
      givenName: 'Ivan',
      familyName: 'Ivanov',
      relationship: 'father',
      canPay: false,
    });
    expect(status).toBe(201);
    expect(body.existing).toBe(false);
  });

  it('lists the child with both guardians and what each may do', async () => {
    const { body } = await get<StudentList>(`/schools/${schoolId}/students`, tokens.principalT!);
    expect(body.students).toHaveLength(1);
    expect(body.students[0]).toMatchObject({ givenName: 'Kalina', classLabel: '1A' });
    expect(body.students[0]!.guardians.map((g) => [g.name, g.relationship, g.status, g.canPay])).toEqual(
      expect.arrayContaining([
        ['Anna Ivanova', 'mother', 'active', true],
        ['Ivan Ivanov', 'father', 'active', false],
      ]),
    );
  });

  it("keeps other schools' staff out", async () => {
    expect((await get(`/schools/${schoolId}/students`, tokens['principal.a']!)).status).toBe(403);
    expect(
      (
        await post(tokens['principal.a']!, `/schools/${schoolId}/students/${kalinaId}/guardians`, {
          email: 'hristo.georgiev@pythagoras.test',
          relationship: 'parent',
        })
      ).status,
    ).toBe(403);
  });
});

describe('Anna, with children at three schools', () => {
  it('sees all three children, each at their own school', async () => {
    const { body } = await get<MeResponse>('/me', tokens['anna.ivanova']!);
    const places = body.children.map((child) => [
      child.givenName,
      child.enrolments.map((e) => e.school.name),
    ]);
    expect(places).toEqual(
      expect.arrayContaining([
        ['Mila', ['School A']],
        ['Boris', ['School C']],
        ['Kalina', [`School T ${run}`]],
      ]),
    );
  });

  it('buys lunch at School A and School T in one basket: one order per company, both paid', async () => {
    const anna = tokens['anna.ivanova']!;
    const mila = await offeringsOf(anna, MILA);
    const kalina = await offeringsOf(anna, kalinaId);
    expect(kalina.lunch).toMatchObject({
      name: `Lunch at School T ${run}`,
      billingEntity: { name: companyName },
    });

    const placed = await fetch(`${API}/checkout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${anna}`,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        items: [
          {
            studentId: MILA,
            offeringId: mila.lunch.id,
            sessionIds: [mila.lunch.sessions.find((s) => !s.alreadyBooked)!.id],
          },
          { studentId: kalinaId, offeringId: kalina.lunch.id, sessionIds: [kalina.lunch.sessions[0]!.id] },
        ],
      }),
    });
    expect(placed.status).toBe(201);
    const checkout = (await placed.json()) as CheckoutResponse;
    expect(checkout.orders.map((order) => [order.billingEntityName, order.totalMinor]).sort()).toEqual(
      [
        ['Testing Company', mila.lunch.price.unitAmountMinor],
        [companyName, 520],
      ].sort(),
    );

    for (const order of checkout.orders) {
      const token = order.checkoutUrl!.split('/dev-payments/checkout/')[1]!;
      await fetch(`${API}/dev-payments/checkout/${token}/succeed`, { method: 'POST', redirect: 'manual' });
    }
    const deadline = Date.now() + 15_000;
    let view: CheckoutGroupView;
    do {
      await new Promise((resolve) => setTimeout(resolve, 250));
      view = (await get<CheckoutGroupView>(`/checkout-groups/${checkout.checkoutGroupId}`, anna)).body;
    } while (view.orders.some((order) => order.status !== 'paid') && Date.now() < deadline);
    expect(view.orders.map((order) => order.status)).toEqual(['paid', 'paid']);
  });
});
