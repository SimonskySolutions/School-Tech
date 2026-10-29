import { describe, expect, it } from 'vitest';
import { EventDispatcher } from './event-dispatcher';
import { type OutboxJobData } from './outbox-relay';

const event = (eventType: string): OutboxJobData => ({
  eventId: 'e1',
  groupId: 'g1',
  aggregateType: 'commerce.order',
  aggregateId: 'o1',
  eventType,
  payload: {},
  occurredAt: '2026-10-29T12:00:00.000Z',
});

describe('EventDispatcher', () => {
  it('runs every handler registered for the event type, in order', async () => {
    const calls: string[] = [];
    const dispatcher = new EventDispatcher()
      .on('commerce.order.paid', () => Promise.resolve(void calls.push('confirmation')))
      .on('commerce.order.paid', () => Promise.resolve(void calls.push('accounting')))
      .on('commerce.order.placed', () => Promise.resolve(void calls.push('other')));
    expect(await dispatcher.dispatch(event('commerce.order.paid'))).toEqual({ handled: 2 });
    expect(calls).toEqual(['confirmation', 'accounting']);
  });

  it('completes quietly when nothing subscribes to an event', async () => {
    expect(await new EventDispatcher().dispatch(event('people.person.updated'))).toBe('no-handler');
  });

  it('fails the job when a handler fails, so the queue retries it', async () => {
    const dispatcher = new EventDispatcher().on('x.y', () => Promise.reject(new Error('mail server down')));
    await expect(dispatcher.dispatch(event('x.y'))).rejects.toThrow('mail server down');
  });
});
