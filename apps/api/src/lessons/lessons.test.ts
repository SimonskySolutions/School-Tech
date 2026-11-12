import { describe, expect, it } from 'vitest';
import { bookSchema, hoursSchema, resourceSchema, slotsSchema } from './lessons.controller';

const id = '01a18e7b-baec-7c6b-a92d-881b1ae3371a';

describe('lesson requests', () => {
  it('books a slot from a package by their ids', () => {
    expect(bookSchema.safeParse({ sessionId: id, packageId: id }).success).toBe(true);
    expect(bookSchema.safeParse({ sessionId: id }).success).toBe(false);
  });

  it('adds a teacher or a room with a name', () => {
    expect(resourceSchema.parse({ kind: 'room', displayName: ' Music room ' })).toEqual({
      kind: 'room',
      displayName: 'Music room',
    });
    expect(resourceSchema.safeParse({ kind: 'bus', displayName: 'Bus 1' }).success).toBe(false);
    expect(resourceSchema.safeParse({ kind: 'teacher', displayName: '' }).success).toBe(false);
  });

  it('takes weekly hours as a weekday and a start before the end', () => {
    expect(hoursSchema.safeParse({ weekday: 2, starts: '14:00', ends: '17:00' }).success).toBe(true);
    expect(hoursSchema.safeParse({ weekday: 8, starts: '14:00', ends: '17:00' }).success).toBe(false);
    expect(hoursSchema.safeParse({ weekday: 2, starts: '17:00', ends: '14:00' }).success).toBe(false);
    expect(hoursSchema.safeParse({ weekday: 2, starts: '9:00', ends: '17:00' }).success).toBe(false);
  });

  it('creates slots of 15 to 240 minutes between two days in order', () => {
    const slots = {
      offeringId: id,
      teacherId: id,
      roomId: id,
      from: '2026-11-02',
      to: '2026-11-30',
      minutes: 45,
    };
    expect(slotsSchema.safeParse(slots).success).toBe(true);
    expect(slotsSchema.safeParse({ ...slots, minutes: 10 }).success).toBe(false);
    expect(slotsSchema.safeParse({ ...slots, to: '2026-11-01' }).success).toBe(false);
  });
});
