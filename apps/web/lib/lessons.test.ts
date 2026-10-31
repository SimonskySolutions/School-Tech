import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import { hoursBody, resourceBody, slotsBody } from './lessons';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe('lesson forms', () => {
  it('reads a teacher or a room with its name', () => {
    expect(resourceBody(form({ kind: 'room', display_name: ' Music room ' }))).toEqual({
      kind: 'room',
      displayName: 'Music room',
    });
    expect(() => resourceBody(form({ kind: 'bus', display_name: 'Bus' }))).toThrow(FormProblem);
    expect(() => resourceBody(form({ kind: 'teacher', display_name: '' }))).toThrow(FormProblem);
  });

  it('reads weekly hours as a weekday and a start before the end', () => {
    expect(hoursBody(form({ weekday: '2', starts: '14:00', ends: '17:00' }))).toEqual({
      weekday: 2,
      starts: '14:00',
      ends: '17:00',
    });
    expect(() => hoursBody(form({ weekday: '0', starts: '14:00', ends: '17:00' }))).toThrow(FormProblem);
    expect(() => hoursBody(form({ weekday: '2', starts: '2pm', ends: '17:00' }))).toThrow(FormProblem);
    expect(() => hoursBody(form({ weekday: '2', starts: '17:00', ends: '14:00' }))).toThrow(FormProblem);
  });

  it('reads the lesson times to create', () => {
    const fields = {
      offering_id: 'o',
      teacher_id: 't',
      room_id: 'r',
      from: '2026-11-02',
      to: '2026-11-30',
      minutes: '45',
    };
    expect(slotsBody(form(fields))).toEqual({
      offeringId: 'o',
      teacherId: 't',
      roomId: 'r',
      from: '2026-11-02',
      to: '2026-11-30',
      minutes: 45,
    });
    expect(() => slotsBody(form({ ...fields, to: '2026-11-01' }))).toThrow(FormProblem);
    expect(() => slotsBody(form({ ...fields, minutes: '5' }))).toThrow(FormProblem);
  });
});
