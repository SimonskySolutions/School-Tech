import { type MyStaffRecords, type SchoolStaff } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, post, tokenFor } from './helpers';

// Qualifications and checks (M6.2) against the real stack. The seed gives the
// principal of School A first aid and a record check both ending within 60
// days, the School A kitchen food hygiene and no record check, and the School
// B teacher a licence and a valid check.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const SCHOOL_B = 'b1000000-0000-7000-8000-00000000000b';
const PRINCIPAL_A = 'c1000000-0000-7000-8000-000000000006';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const TEACHER_B = 'c1000000-0000-7000-8000-000000000010';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const tokens: Record<string, string> = {};
const person = async (user: string, school: string, personId: string) =>
  (await get<SchoolStaff>(`/schools/${school}/staff`, tokens[user]!)).body.people.find(
    (p) => p.personId === personId,
  )!;

beforeAll(async () => {
  for (const user of ['principal.a', 'principal.b', 'teacher.b', 'kitchen.a', 'anna.ivanova']) {
    tokens[user] = await tokenFor(user);
  }
});

describe('what needs attention', () => {
  it('flags checks and qualifications ending within 60 days, and a missing check', async () => {
    expect((await person('principal.a', SCHOOL_A, PRINCIPAL_A)).attention).toEqual([
      'check_expiring',
      'qualification_expiring',
    ]);
    const kitchen = await person('principal.a', SCHOOL_A, KITCHEN_A);
    expect(kitchen.attention).toEqual(['check_missing']);
    expect(kitchen.qualifications).toEqual([
      expect.objectContaining({ kind: 'food_hygiene', title: 'Food hygiene, level 2', state: 'valid' }),
    ]);
    const teacher = await person('principal.b', SCHOOL_B, TEACHER_B);
    expect(teacher.attention).toEqual([]);
    expect(teacher.recordCheck).toMatchObject({ state: 'valid', seenBy: 'Desislava Todorova' });
  });
});

describe('recording qualifications and checks', () => {
  it('lets the principal record for their own staff only, and a check as dates only', async () => {
    const qualification = {
      kind: 'first_aid',
      title: 'First aid (integration test)',
      awardedOn: day(-30),
      expiresOn: day(700),
    };
    expect(
      (await post(tokens['principal.a']!, `/staff/people/${TEACHER_B}/qualifications`, qualification)).status,
    ).toBe(404);
    expect(
      (await post(tokens['teacher.b']!, `/staff/people/${TEACHER_B}/qualifications`, qualification)).status,
    ).toBe(404);
    const recorded = await post<{ id: string }>(
      tokens['principal.a']!,
      `/staff/people/${KITCHEN_A}/qualifications`,
      qualification,
    );
    expect(recorded.status).toBe(201);

    const check = { seenOn: day(0), validUntil: day(180) };
    expect(
      (
        await post(tokens['principal.a']!, `/staff/people/${KITCHEN_A}/checks`, {
          ...check,
          outcome: 'clear',
        })
      ).status,
    ).toBe(400);
    expect((await post(tokens['teacher.b']!, `/staff/people/${TEACHER_B}/checks`, check)).status).toBe(404);
    expect(
      (
        await post(tokens['principal.a']!, `/staff/people/${KITCHEN_A}/checks`, {
          seenOn: day(1),
          validUntil: day(180),
        })
      ).status,
    ).toBe(422);
    expect((await post(tokens['principal.a']!, `/staff/people/${KITCHEN_A}/checks`, check)).status).toBe(201);
    expect((await person('principal.a', SCHOOL_A, KITCHEN_A)).attention).toEqual([]);

    const mine = (await get<MyStaffRecords>('/staff/me', tokens['kitchen.a']!)).body;
    expect(mine.qualifications.map((q) => q.title)).toEqual(
      expect.arrayContaining(['Food hygiene, level 2', 'First aid (integration test)']),
    );
    expect(mine.recordCheck).toMatchObject({ seenOn: day(0), validUntil: day(180), state: 'valid' });

    const withdraw = (user: string) =>
      post(tokens[user]!, `/staff/qualifications/${recorded.body.id}/withdraw`);
    expect((await withdraw('teacher.b')).status).toBe(404);
    expect((await withdraw('principal.a')).status).toBe(200);
    expect((await withdraw('principal.a')).status).toBe(409);
    expect((await person('principal.a', SCHOOL_A, KITCHEN_A)).qualifications.map((q) => q.title)).toEqual([
      'Food hygiene, level 2',
    ]);
  });
});
