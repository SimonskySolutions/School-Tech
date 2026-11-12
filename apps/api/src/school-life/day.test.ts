import { type SchoolId } from '@pythagoras/shared';
import { describe, expect, it } from 'vitest';
import { type DayParts, summariseDay } from './day';

const A = 'school-a' as SchoolId;
const B = 'school-b' as SchoolId;
const school = (id: SchoolId, name: string) => ({ id, name, timeZone: 'Europe/Sofia' });

const parts: DayParts = {
  school: school(A, 'School A'),
  date: '2026-11-18',
  schools: [
    { id: A, name: 'School A' },
    { id: B, name: 'School B' },
  ],
  kitchen: {
    from: '2026-11-18',
    days: 1,
    schools: [
      {
        school: school(A, 'School A'),
        showsDietary: true,
        days: [
          {
            date: '2026-11-18',
            meals: 12,
            awaitingPayment: 2,
            capacity: 250,
            menu: [{ course: 'main', name: 'Fish', allergens: ['fish'] }],
            dietary: [
              {
                studentName: 'Mila Ivanova',
                classLabel: '3A',
                kind: 'allergy',
                severity: 'severe',
                description: 'Fish',
                allergens: ['fish'],
                verified: true,
                menuConflicts: [{ dish: 'Fish', allergens: ['fish'] }],
              },
            ],
          },
        ],
      },
      { school: school(B, 'School B'), showsDietary: true, days: [] },
    ],
  },
  registers: {
    from: '2026-11-18',
    days: 1,
    sessions: [
      {
        id: 'chess',
        offering: { id: 'o', name: 'Chess club' },
        school: school(A, 'School A'),
        startsAt: '2026-11-18T12:00:00Z',
        endsAt: null,
        location: 'Room 12',
        capacity: 12,
        booked: 3,
        awaitingPayment: 0,
        canMark: true,
        attendees: [
          { bookingId: '1', studentName: 'A', classLabel: null, status: 'attended' },
          { bookingId: '2', studentName: 'B', classLabel: null, status: 'absent' },
          { bookingId: '3', studentName: 'C', classLabel: null, status: 'confirmed' },
        ],
      },
      {
        id: 'other',
        offering: { id: 'o2', name: 'Elsewhere' },
        school: school(B, 'School B'),
        startsAt: '2026-11-18T12:00:00Z',
        endsAt: null,
        location: null,
        capacity: null,
        booked: 1,
        awaitingPayment: 0,
        canMark: false,
        attendees: [],
      },
    ],
  },
  trips: {
    from: '2026-11-18',
    days: 1,
    trips: [
      {
        sessionId: 'museum',
        name: 'Museum',
        school: school(A, 'School A'),
        startsAt: '2026-11-18T07:00:00Z',
        endsAt: null,
        location: null,
        capacity: 25,
        booked: 2,
        awaitingPayment: 0,
        participants: [
          {
            studentName: 'A',
            classLabel: null,
            status: 'confirmed',
            permission: null,
            emergencyContact: null,
            dietary: [],
          },
          {
            studentName: 'B',
            classLabel: null,
            status: 'confirmed',
            permission: { givenAt: 'x', channel: 'paper', givenBy: null },
            emergencyContact: null,
            dietary: [],
          },
        ],
      },
    ],
  },
  transport: {
    date: '2026-11-18',
    routes: [
      {
        sessionId: 'bus',
        name: 'Route 1',
        school: { id: A, name: 'School A' },
        term: null,
        vehicle: null,
        seats: 20,
        riders: 4,
        stops: [{ name: 'Park', pickupTime: '07:20', dropoffTime: null, children: [] }],
      },
    ],
  },
  uniforms: {
    school: { id: A, name: 'School A' },
    canManage: true,
    canHandOver: true,
    products: [
      {
        id: 'polo',
        name: 'Polo',
        variants: [
          {
            id: 'v',
            sku: 'P',
            size: '140',
            colour: null,
            price: null,
            onHand: 1,
            reserved: 0,
            allocated: 0,
            free: 1,
            lowStock: true,
            lowStockThreshold: 3,
            active: true,
          },
        ],
      },
    ],
    awaitingHandOver: [
      {
        reservationId: 'r',
        product: 'Polo',
        variant: '128',
        quantity: 2,
        studentName: null,
        classLabel: null,
        paidAt: null,
      },
    ],
  },
  requests: null,
  dietaryToVerify: 1,
};

describe('the School Life day', () => {
  it('keeps only the chosen school and counts what needs doing', () => {
    const day = summariseDay(parts);
    expect(day.lunch).toMatchObject({ meals: 12, awaitingPayment: 2, dishes: 1 });
    expect(day.lunch!.alerts).toEqual([
      expect.objectContaining({ studentName: 'Mila Ivanova', onMenu: ['Fish'], verified: true }),
    ]);
    expect(day.sessions).toEqual([
      expect.objectContaining({ id: 'chess', booked: 3, marked: 2, canMark: true }),
    ]);
    expect(day.trips).toEqual([expect.objectContaining({ name: 'Museum', booked: 2, withoutPermission: 1 })]);
    expect(day.transport).toEqual([{ name: 'Route 1', riders: 4, seats: 20, firstPickup: '07:20' }]);
    expect(day.uniforms).toEqual({ awaitingHandOver: 2, lowStock: 1 });
    expect(day.dietaryToVerify).toBe(1);
  });

  it('leaves out what the viewer may not see, and a day without lunch', () => {
    const day = summariseDay({ ...parts, school: school(B, 'School B') });
    expect(day.lunch).toBeNull();
    expect(day.requests).toBeNull();
    expect(day.sessions.map((session) => session.id)).toEqual(['other']);
    expect(day.transport).toEqual([]);
  });
});
