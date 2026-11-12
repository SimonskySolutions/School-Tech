import { describe, expect, it } from 'vitest';
import { routeSchema, stopSchema } from './transport.controller';

const id = '01a18e7b-baec-7c6b-a92d-881b1ae3371a';

describe('transport requests', () => {
  it('takes a route with weekdays 1 to 7, in order and once each', () => {
    expect(routeSchema.parse({ offeringId: id, weekdays: [5, 1, 3, 1] }).weekdays).toEqual([1, 3, 5]);
    expect(routeSchema.safeParse({ offeringId: id, weekdays: [] }).success).toBe(false);
    expect(routeSchema.safeParse({ offeringId: id, weekdays: [8] }).success).toBe(false);
  });

  it('takes a stop with a name and pick-up time; drop-off is optional', () => {
    expect(stopSchema.safeParse({ name: 'Park', pickupTime: '07:30' }).success).toBe(true);
    expect(stopSchema.safeParse({ name: 'Park', pickupTime: '7:30' }).success).toBe(false);
    expect(stopSchema.safeParse({ name: '', pickupTime: '07:30' }).success).toBe(false);
  });
});
