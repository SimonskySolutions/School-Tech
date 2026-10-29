import { type OutboxJobData } from './outbox-relay';

// Routes each event from the "events" queue to the handlers registered for its
// type. Handlers must be idempotent: delivery is at least once. An event with
// no handler is normal (nothing subscribes to it yet) and completes quietly.

export type EventHandler = (event: OutboxJobData) => Promise<void>;

export type DispatchOutcome = { handled: number } | 'no-handler';

export class EventDispatcher {
  private readonly handlers = new Map<string, EventHandler[]>();

  on(eventType: string, handler: EventHandler): this {
    this.handlers.set(eventType, [...(this.handlers.get(eventType) ?? []), handler]);
    return this;
  }

  async dispatch(event: OutboxJobData): Promise<DispatchOutcome> {
    const handlers = this.handlers.get(event.eventType) ?? [];
    if (handlers.length === 0) return 'no-handler';
    // Sequential, so a failing handler stops the job and BullMQ retries all of them.
    for (const handler of handlers) await handler(event);
    return { handled: handlers.length };
  }
}
