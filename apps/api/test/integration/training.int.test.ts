import { type MeResponse, type MyStaffRecords, type SchoolStaff } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, post, tokenFor } from './helpers';

// Professional development (M6.3) against the real stack. The seed has the
// School B teacher's attended course (8 h) and planned conference (12 h) and
// the School A principal's workshop (4 h), all in this school year.

const SCHOOL_B = 'b1000000-0000-7000-8000-00000000000b';
const TEACHER_B = 'c1000000-0000-7000-8000-000000000010';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const PLANNED_CONFERENCE = 'df000000-0000-7000-8000-000000000102';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const tokens: Record<string, string> = {};
const teacherAtB = async (query = '') =>
  (await get<SchoolStaff>(`/schools/${SCHOOL_B}/staff${query}`, tokens['principal.b']!)).body;

beforeAll(async () => {
  for (const user of ['teacher.b', 'principal.b', 'kitchen.a', 'anna.ivanova'])
    tokens[user] = await tokenFor(user);
});

describe('professional development', () => {
  it('shows the school’s leaders each person’s hours for the school year', async () => {
    const view = await teacherAtB();
    expect(view.schoolYear).toMatch(/^\d{4}\/\d{2}$/);
    const teacher = view.people.find((person) => person.personId === TEACHER_B)!;
    expect(teacher.trainingHours).toEqual({ attended: 8, planned: 12 });
    expect(teacher.training.map((t) => t.title)).toEqual([
      'Teaching with manipulatives (synthetic)',
      "Mathematics teachers' conference (synthetic)",
    ]);
    const before = await teacherAtB(
      `?year=${Number(view.schoolYear.slice(0, 4)) - 1}/${view.schoolYear.slice(2, 4)}`,
    );
    expect(before.trainingHours).toEqual({ attended: 0, planned: 0 });
    expect((await get(`/schools/${SCHOOL_B}/staff?year=last`, tokens['principal.b']!)).status).toBe(400);
  });

  it('lets staff record their own training, and nobody else’s', async () => {
    const training = {
      title: 'Online safety (integration test)',
      kind: 'online',
      startsOn: day(-2),
      endsOn: day(-2),
      hours: 1.5,
      status: 'attended',
    };
    expect((await post(tokens['teacher.b']!, `/staff/people/${KITCHEN_A}/training`, training)).status).toBe(
      404,
    );
    const anna = (await get<MeResponse>('/me', tokens['anna.ivanova']!)).body.person.id;
    expect((await post(tokens['anna.ivanova']!, `/staff/people/${anna}/training`, training)).status).toBe(
      404,
    );
    expect(
      (
        await post(tokens['teacher.b']!, `/staff/people/${TEACHER_B}/training`, {
          ...training,
          startsOn: day(5),
          endsOn: day(5),
        })
      ).status,
    ).toBe(422);
    expect((await post(tokens['teacher.b']!, `/staff/people/${TEACHER_B}/training`, training)).status).toBe(
      201,
    );
    expect(
      (await teacherAtB()).people.find((person) => person.personId === TEACHER_B)!.trainingHours,
    ).toEqual({
      attended: 9.5,
      planned: 12,
    });
    const mine = (await get<MyStaffRecords>('/staff/me', tokens['teacher.b']!)).body;
    expect(mine.training.map((t) => t.title)).toContain('Online safety (integration test)');
  });

  it('lets planned training be cancelled, not attended before it starts', async () => {
    const status = (user: string, value: string) =>
      post(tokens[user]!, `/staff/training/${PLANNED_CONFERENCE}/status`, { status: value });
    expect((await status('kitchen.a', 'cancelled')).status).toBe(404);
    expect((await status('teacher.b', 'attended')).status).toBe(422);
    expect((await status('teacher.b', 'cancelled')).status).toBe(200);
    expect((await status('teacher.b', 'cancelled')).status).toBe(409);
    expect(
      (await teacherAtB()).people.find((person) => person.personId === TEACHER_B)!.trainingHours.planned,
    ).toBe(0);
  });
});
