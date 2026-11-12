import { beforeAll, describe, expect, it } from 'vitest';
import { MILA, offeringsOf, payAndWait, placeOrder, tokenFor } from './helpers';

// Notifications by e-mail (M7.1, ADR 0031) against the real stack: Anna pays
// for a lunch for Mila; the worker queues the confirmation once and sends it
// to the development mailbox (Mailpit), with the order and a link, and
// nothing about Mila's dietary needs (her peanut allergy is in the seed).

const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const ANNA = 'anna.ivanova@pythagoras.test';

interface MailSummary {
  ID: string;
  MessageID: string;
  Subject: string;
  To: { Address: string }[];
}

async function search(query: string): Promise<MailSummary[]> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`);
  return ((await response.json()) as { messages: MailSummary[] }).messages;
}

async function waitFor(query: string, timeoutMs = 20_000): Promise<MailSummary[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await search(query);
    if (found.length > 0 || Date.now() > deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

let token: string;

beforeAll(async () => {
  token = await tokenFor('anna.ivanova');
});

describe('notifications', () => {
  it('confirm a paid order to the payer, once, without the child’s dietary needs', async () => {
    const { lunch } = await offeringsOf(token, MILA);
    const free = lunch.sessions.filter((session) => !session.alreadyBooked && (session.available ?? 1) > 0);
    expect(free.length).toBeGreaterThan(0);
    const placed = await placeOrder(token, [
      { studentId: MILA, offeringId: lunch.id, sessionIds: [free[Math.floor(free.length / 2)]!.id] },
    ]);
    await payAndWait(token, placed);
    const orderNumber = placed.orders[0]!.orderNumber;

    const found = await waitFor(`subject:"${orderNumber}"`);
    expect(found).toHaveLength(1);
    const [mail] = found;
    expect(mail!.Subject).toBe(`Payment received: order ${orderNumber}`);
    expect(mail!.To.map((to) => to.Address)).toEqual([ANNA]);
    expect(mail!.MessageID).toMatch(/^[0-9a-f-]{36}@portal\.pythagoras\.localhost$/);

    const body = (await (await fetch(`${MAILPIT}/api/v1/message/${mail!.ID}`)).json()) as { Text: string };
    expect(body.Text).toContain('Dear Anna Ivanova,');
    expect(body.Text).toContain(`http://portal.pythagoras.localhost:53000/orders/${placed.checkoutGroupId}`);
    expect(body.Text.toLowerCase()).not.toMatch(/peanut|allerg|diet|mila/);

    // The event may be delivered again (at least once); the message is not.
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    expect(await search(`subject:"${orderNumber}"`)).toHaveLength(1);
  });
});
