import { type SchoolLessons, type StudentLessons, type StudentOfferings } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, MILA, payAndWait, placeOrder, post, tokenFor } from './helpers';

// Individual lessons (M4.3) against the real stack. The seed has piano lessons
// at School A sold as packages of 5, a piano teacher (Tuesdays and Thursdays
// 14:00-17:00), the music room and 45-minute slots for four weeks. Anna buys a
// package for Mila and books, races for and cancels lessons.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const PIANO = 'd2000000-0000-7000-8000-0000000000a6';
const ROOM = 'd4000000-0000-7000-8000-0000000000a2';

const tokens: Record<string, string> = {};
const lessons = async () =>
  (await get<StudentLessons>(`/students/${MILA}/lessons`, tokens['anna.ivanova']!)).body;
const book = (sessionId: string, packageId: string, user = 'anna.ivanova') =>
  post<{ bookingId: string }>(tokens[user]!, `/students/${MILA}/lessons`, { sessionId, packageId });

beforeAll(async () => {
  for (const user of [
    'anna.ivanova',
    'schoollife',
    'kitchen.a',
    'teacher.b',
    'principal.a',
    'hristo.georgiev',
  ]) {
    tokens[user] = await tokenFor(user);
  }
});

describe('buying a package', () => {
  it('offers Anna the piano package for Mila, without slots to pick in the basket', async () => {
    const { body } = await get<StudentOfferings>(`/students/${MILA}/offerings`, tokens['anna.ivanova']!);
    const piano = body.offerings.find((offering) => offering.id === PIANO)!;
    expect(piano).toMatchObject({
      kind: 'lesson',
      package: { lessons: 5 },
      sessions: [],
      price: { unitAmountMinor: 12000, unit: 'per_package' },
    });
  });

  it('gives Mila a package of 5 lessons once the payment is confirmed', async () => {
    const before = (await lessons()).packages.length;
    const anna = tokens['anna.ivanova']!;
    await payAndWait(anna, await placeOrder(anna, [{ studentId: MILA, offeringId: PIANO }]));
    const after = await lessons();
    expect(after.packages).toHaveLength(before + 1);
    expect(after.packages.at(-1)).toMatchObject({ offeringId: PIANO, lessonsBought: 5, lessonsLeft: 5 });
    expect(after.slots.length).toBeGreaterThan(5);
    expect(after.slots[0]).toMatchObject({ teacher: 'Ms Elena Georgieva (piano)', room: 'Music room' });
  });
});

describe('booking and cancelling lessons', () => {
  let packageId: string;
  let slots: string[];

  beforeAll(async () => {
    const mine = await lessons();
    packageId = mine.packages.find((p) => p.lessonsLeft === 5)!.id;
    // Latest first: far enough ahead to be before the cancellation cutoff.
    slots = mine.slots.map((slot) => slot.sessionId).reverse();
  });

  it('books a slot with one lesson of the package', async () => {
    const booked = await book(slots[0]!, packageId);
    expect(booked.status).toBe(201);
    const mine = await lessons();
    expect(mine.packages.find((p) => p.id === packageId)!.lessonsLeft).toBe(4);
    expect(mine.slots.map((slot) => slot.sessionId)).not.toContain(slots[0]);
    expect(mine.bookings.find((b) => b.bookingId === booked.body.bookingId)).toMatchObject({
      status: 'confirmed',
      canCancel: true,
      cancelReturnsLesson: true,
    });
  });

  it('lets exactly one of two requests for the same slot through', async () => {
    const results = await Promise.all([book(slots[1]!, packageId), book(slots[1]!, packageId)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await lessons()).packages.find((p) => p.id === packageId)!.lessonsLeft).toBe(3);
  });

  it('never spends the same last lesson twice', async () => {
    expect((await book(slots[2]!, packageId)).status).toBe(201);
    expect((await book(slots[3]!, packageId)).status).toBe(201);
    const results = await Promise.all([book(slots[4]!, packageId), book(slots[5]!, packageId)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.message).toBe('the package has no lessons left');
    expect((await lessons()).packages.find((p) => p.id === packageId)!.lessonsLeft).toBe(0);
  });

  it('gives the lesson back when Anna cancels before the cutoff', async () => {
    const mine = await lessons();
    const lesson = mine.bookings.find((b) => b.sessionId === slots[0])!;
    const cancelled = await post<{ outcome: string }>(
      tokens['anna.ivanova']!,
      `/students/${MILA}/lessons/${lesson.bookingId}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.outcome).toBe('returned');
    const after = await lessons();
    expect(after.packages.find((p) => p.id === packageId)!.lessonsLeft).toBe(1);
    expect(after.slots.map((slot) => slot.sessionId)).toContain(slots[0]);
    expect(
      (await post(tokens['anna.ivanova']!, `/students/${MILA}/lessons/${lesson.bookingId}/cancel`)).status,
    ).toBe(409);
  });

  it("keeps other families out of Mila's lessons", async () => {
    expect((await get(`/students/${MILA}/lessons`, tokens['hristo.georgiev']!)).status).toBe(404);
    expect((await book(slots[0]!, packageId, 'hristo.georgiev')).status).toBe(404);
  });
});

describe('teachers, rooms and slots for staff', () => {
  it('shows School Life the teacher, the room, their hours and who is booked', async () => {
    const { status, body } = await get<SchoolLessons>(
      `/schools/${SCHOOL_A}/lessons?days=31`,
      tokens.schoollife!,
    );
    expect(status).toBe(200);
    expect(body.canManage).toBe(true);
    const teacher = body.resources.find((r) => r.displayName === 'Ms Elena Georgieva (piano)')!;
    expect(teacher.hours).toEqual(
      expect.arrayContaining([expect.objectContaining({ weekday: 2, starts: '14:00', ends: '17:00' })]),
    );
    expect(body.offerings).toContainEqual({
      id: PIANO,
      name: 'Piano lessons, School A (5 lessons)',
      packageSize: 5,
    });
    expect(body.slots.filter((slot) => slot.bookedFor === 'Mila Ivanova').length).toBeGreaterThanOrEqual(4);
  });

  it('lets the kitchen look but not change anything, and keeps other schools out', async () => {
    const { body } = await get<SchoolLessons>(`/schools/${SCHOOL_A}/lessons`, tokens['kitchen.a']!);
    expect(body.canManage).toBe(false);
    expect(
      (await post(tokens['kitchen.a']!, `/schools/${SCHOOL_A}/resources`, { kind: 'room', displayName: 'x' }))
        .status,
    ).toBe(403);
    expect((await get(`/schools/${SCHOOL_A}/lessons`, tokens['teacher.b']!)).status).toBe(404);
  });

  it('lets the principal add a teacher with hours and create slots, never twice', async () => {
    const principal = tokens['principal.a']!;
    const teacher = await post<{ id: string }>(principal, `/schools/${SCHOOL_A}/resources`, {
      kind: 'teacher',
      displayName: 'Mr Violin (integration test)',
    });
    expect(teacher.status).toBe(201);
    expect(
      (
        await post(principal, `/schools/${SCHOOL_A}/resources/${teacher.body.id}/hours`, {
          weekday: 1,
          starts: '10:00',
          ends: '09:00',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(principal, `/schools/${SCHOOL_A}/resources/${teacher.body.id}/hours`, {
          weekday: 1,
          starts: '09:00',
          ends: '10:00',
        })
      ).status,
    ).toBe(201);
    const today = new Date();
    const from = new Date(today.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 15 * 86_400_000).toISOString().slice(0, 10);
    const request = { offeringId: PIANO, teacherId: teacher.body.id, roomId: ROOM, from, to, minutes: 30 };
    const created = await post<{ created: number }>(principal, `/schools/${SCHOOL_A}/lesson-slots`, request);
    expect(created.status).toBe(201);
    expect(created.body.created).toBe(4);
    const again = await post<{ created: number }>(principal, `/schools/${SCHOOL_A}/lesson-slots`, request);
    expect(again.body.created).toBe(0);
    expect(
      (await post(principal, `/schools/${SCHOOL_A}/lesson-slots`, { ...request, teacherId: ROOM })).status,
    ).toBe(422);
  });
});
