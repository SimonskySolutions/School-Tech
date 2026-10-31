import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import { routeBody, stopBody, termDates } from './transport';

const form = (fields: [string, string][]) => {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
};

describe('transport forms', () => {
  it('reads a route with its days, once each and in order', () => {
    expect(
      routeBody(
        form([
          ['offering_id', 'bus'],
          ['vehicle', ' Minibus '],
          ['weekday', '5'],
          ['weekday', '1'],
          ['weekday', '1'],
          ['weekday', '9'],
        ]),
      ),
    ).toEqual({ offeringId: 'bus', vehicle: 'Minibus', weekdays: [1, 5] });
    expect(() => routeBody(form([['offering_id', 'bus']]))).toThrow(FormProblem);
  });

  it('reads a stop with a pick-up time and an optional time back', () => {
    expect(
      stopBody(
        form([
          ['name', 'Park'],
          ['pickup_time', '07:30'],
        ]),
      ),
    ).toEqual({ name: 'Park', pickupTime: '07:30' });
    expect(
      stopBody(
        form([
          ['name', 'Park'],
          ['pickup_time', '07:30'],
          ['dropoff_time', '16:30'],
        ]),
      ),
    ).toEqual({
      name: 'Park',
      pickupTime: '07:30',
      dropoffTime: '16:30',
    });
    expect(() =>
      stopBody(
        form([
          ['name', 'Park'],
          ['pickup_time', '7.30'],
        ]),
      ),
    ).toThrow(FormProblem);
    expect(() =>
      stopBody(
        form([
          ['name', ''],
          ['pickup_time', '07:30'],
        ]),
      ),
    ).toThrow(FormProblem);
  });
});

describe('term dates', () => {
  it('shows the first and the last day of the term in the school time zone', () => {
    expect(termDates('2026-11-15T22:00:00.000Z', '2027-02-12T22:00:00.000Z', 'Europe/Sofia')).toBe(
      '16 Nov 2026 to 12 Feb 2027',
    );
  });
});
