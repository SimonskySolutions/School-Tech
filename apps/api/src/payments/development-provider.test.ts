import { describe, expect, it } from 'vitest';
import {
  checkoutIdFor,
  DEV_SIGNATURE_HEADER,
  DevelopmentPaymentProvider,
  parseDevelopmentEvent,
} from './development-provider';
import { WebhookRejected } from './provider';

const provider = new DevelopmentPaymentProvider({
  secret: 'a'.repeat(64),
  publicUrl: 'http://api.pythagoras.localhost:53000',
});
const request = {
  paymentId: '01900000-0000-7000-8000-000000000001',
  orderId: '01900000-0000-7000-8000-000000000002',
  groupId: '01900000-0000-7000-8000-000000000003',
  amountMinor: 7400,
  currency: 'EUR',
  description: 'Pythagoras order PY-00000001',
  successUrl: 'http://portal.pythagoras.localhost:53000/orders/g?returned=1',
  cancelUrl: 'http://portal.pythagoras.localhost:53000/orders/g?cancelled=1',
  expiresAt: new Date('2026-10-29T10:30:00Z'),
};

describe('development payment provider', () => {
  it('is always test mode', () => {
    expect(provider.mode).toBe('test');
  });

  it('issues a signed checkout token that only it can read', async () => {
    const checkout = await provider.createCheckout(request);
    expect(checkout.url).toMatch(/^http:\/\/api\.pythagoras\.localhost:53000\/dev-payments\/checkout\//);
    const token = checkout.url.split('/').pop()!;
    expect(checkout.checkoutId).toBe(checkoutIdFor(token));
    expect(provider.readToken(token)).toMatchObject({ paymentId: request.paymentId, amountMinor: 7400 });

    const other = new DevelopmentPaymentProvider({ secret: 'b'.repeat(64), publicUrl: 'http://x' });
    expect(other.readToken(token)).toBeNull();
    const [body, mac] = token.split('.');
    const changed = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), amountMinor: 1 }),
    ).toString('base64url');
    expect(provider.readToken(`${changed}.${mac}`)).toBeNull();
    expect(provider.readToken('garbage')).toBeNull();
  });

  it('signs its events so the webhook endpoint can verify them', async () => {
    const token = (await provider.createCheckout(request)).url.split('/').pop()!;
    const event = provider.buildEvent(token, provider.readToken(token)!, 'succeeded');
    const verified = provider.verifyWebhook(Buffer.from(event.body), {
      [DEV_SIGNATURE_HEADER]: event.signature,
    });
    expect(verified.type).toBe('checkout.completed');

    expect(parseDevelopmentEvent(verified.payload)).toMatchObject({
      checkoutId: checkoutIdFor(token),
      outcome: 'succeeded',
      amountMinor: 7400,
      currency: 'EUR',
      providerPaymentId: `dev_pi_${request.paymentId}`,
    });
  });

  it('rejects unsigned, re-signed or non-JSON webhooks', async () => {
    const token = (await provider.createCheckout(request)).url.split('/').pop()!;
    const event = provider.buildEvent(token, provider.readToken(token)!, 'failed');
    expect(() => provider.verifyWebhook(Buffer.from(event.body), {})).toThrow(WebhookRejected);
    const forged = event.body.replace('"amount_minor":7400', '"amount_minor":1');
    expect(() =>
      provider.verifyWebhook(Buffer.from(forged), { [DEV_SIGNATURE_HEADER]: event.signature }),
    ).toThrow(WebhookRejected);
    expect(parseDevelopmentEvent(JSON.parse(event.body))).toMatchObject({
      outcome: 'failed',
      failureCode: 'card_declined',
    });
    expect(parseDevelopmentEvent({ id: 'x' })).toBeNull();
  });
});
