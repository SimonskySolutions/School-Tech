import { describe, expect, it } from 'vitest';
import { WebhookRejected } from './provider';
import { signPayload } from './signature';
import { parseStripeEvent, STRIPE_SIGNATURE_HEADER, StripePaymentProvider } from './stripe-provider';

// Against Stripe's documented request and event formats; no Stripe account is
// involved (ADR 0010). A real test-mode run is still required before go-live.

const WEBHOOK_SECRET = 'whsec_test_secret';

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_123',
    amount_total: 7400,
    currency: 'eur',
    payment_status: 'paid',
    payment_intent: 'pi_123',
    ...overrides,
  };
}

function event(type: string, object: unknown, livemode = false) {
  return { id: 'evt_123', type, created: 1_800_000_000, livemode, data: { object } };
}

describe('Stripe checkout', () => {
  it('creates a hosted checkout session with an idempotency key per payment', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_abc',
      webhookSecret: WEBHOOK_SECRET,
      fetch: (url, init) => {
        calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init! });
        return Promise.resolve(
          Response.json({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' }),
        );
      },
    });
    expect(provider.mode).toBe('test');
    const checkout = await provider.createCheckout({
      paymentId: 'pay-1',
      orderId: 'order-1',
      groupId: 'group-1',
      amountMinor: 7400,
      currency: 'EUR',
      description: 'Pythagoras order PY-00000001',
      successUrl: 'https://portal.example/orders/g?returned=1',
      cancelUrl: 'https://portal.example/orders/g?cancelled=1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(checkout).toEqual({
      checkoutId: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    });

    const [call] = calls;
    expect(call!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const headers = call!.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('checkout-pay-1');
    expect(headers.authorization).toBe('Bearer sk_test_abc');
    const form = call!.init.body as URLSearchParams;
    expect(form.get('line_items[0][price_data][currency]')).toBe('eur');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('7400');
    expect(form.get('metadata[payment_id]')).toBe('pay-1');
    // Stripe's minimum session lifetime is 30 minutes.
    expect(Number(form.get('expires_at'))).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 1799);
  });

  it('reports a refused session as an error', async () => {
    const provider = new StripePaymentProvider({
      secretKey: 'sk_test_abc',
      webhookSecret: WEBHOOK_SECRET,
      fetch: () => Promise.resolve(new Response('{}', { status: 402 })),
    });
    await expect(
      provider.createCheckout({
        paymentId: 'p',
        orderId: 'o',
        groupId: 'g',
        amountMinor: 1,
        currency: 'EUR',
        description: 'x',
        successUrl: 'https://a',
        cancelUrl: 'https://a',
        expiresAt: new Date(),
      }),
    ).rejects.toThrow('402');
  });
});

describe('Stripe webhooks', () => {
  const provider = new StripePaymentProvider({ secretKey: 'sk_test_abc', webhookSecret: WEBHOOK_SECRET });
  const signed = (body: unknown) => {
    const raw = JSON.stringify(body);
    return {
      raw: Buffer.from(raw),
      headers: { [STRIPE_SIGNATURE_HEADER]: signPayload(WEBHOOK_SECRET, raw) },
    };
  };

  it('verifies a signed test-mode event', () => {
    const { raw, headers } = signed(event('checkout.session.completed', session()));
    expect(provider.verifyWebhook(raw, headers)).toMatchObject({
      eventId: 'evt_123',
      type: 'checkout.session.completed',
    });
  });

  it('refuses a live event for a test key, and unsigned events', () => {
    const live = signed(event('checkout.session.completed', session(), true));
    expect(() => provider.verifyWebhook(live.raw, live.headers)).toThrow('event mode does not match the key');
    expect(() => provider.verifyWebhook(live.raw, {})).toThrow(WebhookRejected);
  });

  it('maps checkout session events to payment outcomes', () => {
    expect(parseStripeEvent(event('checkout.session.completed', session()))).toMatchObject({
      outcome: 'succeeded',
      checkoutId: 'cs_test_123',
      amountMinor: 7400,
      currency: 'EUR',
      providerPaymentId: 'pi_123',
    });
    // A bank debit completes the session before the money arrives.
    expect(
      parseStripeEvent(event('checkout.session.completed', session({ payment_status: 'unpaid' })))?.outcome,
    ).toBe('pending');
    expect(parseStripeEvent(event('checkout.session.async_payment_succeeded', session()))?.outcome).toBe(
      'succeeded',
    );
    expect(parseStripeEvent(event('checkout.session.async_payment_failed', session()))).toMatchObject({
      outcome: 'failed',
      failureCode: 'async_payment_failed',
    });
    expect(
      parseStripeEvent(event('checkout.session.expired', session({ payment_status: 'unpaid' })))?.outcome,
    ).toBe('expired');
  });

  it('ignores event types it does not act on', () => {
    expect(parseStripeEvent(event('customer.created', {}))).toBeNull();
    expect(parseStripeEvent({ nonsense: true })).toBeNull();
  });
});
