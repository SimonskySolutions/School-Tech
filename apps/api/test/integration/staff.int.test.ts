import { type MyStaffRecords, type SchoolStaff } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, post, tokenFor } from './helpers';

// Staff records (M6.1, ADR 0028) against the real stack. The seed has
// employments for the principals of Schools A and B, the School A kitchen and
// the School B teacher, and none for the principal of School C.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const SCHOOL_B = 'b1000000-0000-7000-8000-00000000000b';
const SCHOOL_C = 'b1000000-0000-7000-8000-00000000000c';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const TEACHER_B = 'c1000000-0000-7000-8000-000000000010';

const tokens: Record<string, string> = {};
const staff = (user: string, school: string) => get<SchoolStaff>(`/schools/${school}/staff`, tokens[user]!);

beforeAll(async () => {
  for (const user of [
    'principal.a',
    'principal.c',
    'teacher.b',
    'kitchen.a',
    'ceo',
    'admin',
    'anna.ivanova',
  ]) {
    tokens[user] = await tokenFor(user);
  }
});

describe('a school’s staff records', () => {
  it('shows the principal their staff with roles and employments', async () => {
    const { status, body } = await staff('principal.a', SCHOOL_A);
    expect(status).toBe(200);
    expect(body.canManage).toBe(true);
    const kitchen = body.people.find((person) => person.personId === KITCHEN_A)!;
    expect(kitchen).toMatchObject({ roles: ['kitchen'], mismatch: null });
    expect(kitchen.employments).toEqual([
      expect.objectContaining({
        position: 'Cook',
        workingTime: 0.75,
        contractKind: 'permanent',
        current: true,
      }),
    ]);
    expect(body.employers.length).toBeGreaterThan(0);
  });

  it('flags a role without an employment', async () => {
    const { body } = await staff('principal.c', SCHOOL_C);
    expect(body.people.find((person) => person.name === 'Stefan Angelov')!.mismatch).toBe(
      'role_without_employment',
    );
  });

  it('shows the group’s leaders every school, and colleagues nothing', async () => {
    expect((await staff('ceo', SCHOOL_A)).body.canManage).toBe(false);
    expect((await staff('admin', SCHOOL_B)).body.canManage).toBe(true);
    for (const [user, school] of [
      ['teacher.b', SCHOOL_B],
      ['kitchen.a', SCHOOL_A],
      ['principal.c', SCHOOL_A],
      ['anna.ivanova', SCHOOL_A],
    ] as const) {
      expect((await staff(user, school)).status).toBe(404);
    }
  });
});

describe('recording and ending employments', () => {
  it('records an employment at the principal’s own school only, with no payroll fields', async () => {
    const body = {
      personId: KITCHEN_A,
      employerId: (await staff('principal.a', SCHOOL_A)).body.employers.find(
        (e) => e.name === 'Testing Company',
      )!.id,
      position: 'Kitchen assistant (integration test)',
      contractKind: 'temporary',
      workingTime: 0.25,
      startDate: '2026-11-01',
    };
    expect(
      (await post(tokens['principal.a']!, `/schools/${SCHOOL_A}/staff/employments`, { ...body, salary: 900 }))
        .status,
    ).toBe(400);
    expect(
      (
        await post(tokens['principal.a']!, `/schools/${SCHOOL_A}/staff/employments`, {
          ...body,
          personId: TEACHER_B,
        })
      ).status,
    ).toBe(404);
    expect((await post(tokens['teacher.b']!, `/schools/${SCHOOL_B}/staff/employments`, body)).status).toBe(
      403,
    );
    const recorded = await post<{ id: string }>(
      tokens['principal.a']!,
      `/schools/${SCHOOL_A}/staff/employments`,
      body,
    );
    expect(recorded.status).toBe(201);

    const end = (user: string, endDate: string) =>
      post(tokens[user]!, `/staff/employments/${recorded.body.id}/end`, { endDate });
    expect((await end('teacher.b', '2026-12-31')).status).toBe(404);
    expect((await end('principal.a', '2026-12-31')).status).toBe(200);
    expect((await end('principal.a', '2027-01-31')).status).toBe(409);

    const mine = (await get<MyStaffRecords>('/staff/me', tokens['kitchen.a']!)).body.employments;
    expect(mine.map((employment) => employment.position)).toEqual(
      expect.arrayContaining(['Cook', 'Kitchen assistant (integration test)']),
    );
    expect(mine.find((employment) => employment.position === 'Cook')!.school).toEqual({
      id: SCHOOL_A,
      name: 'School A',
    });
    expect((await get<MyStaffRecords>('/staff/me', tokens['anna.ivanova']!)).body).toEqual({
      employments: [],
      qualifications: [],
      recordCheck: null,
    });
  });
});
