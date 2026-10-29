import { z } from 'zod';
import {
  type Checkout,
  type CheckoutRequest,
  type PaymentProvider,
  type ProviderEvent,
  type VerifiedWebhook,
  WebhookRejected,
} from './provider';
import { parseJson, verifySignature } from './signature';

// Stripe hosted checkout (ADR 0010). Built against Stripe's documented API and
// webhook formats, and unit-tested against them; NOT validated with a real
// Stripe account yet. The API refuses to select it without keys.

export const STRIPE_SIGNATURE_HEADER = 'stripe-signature';
const STRIPE_API = 'https://api.stripe.com/v1';

const sessionObject = z.object({
  id: z.string().startsWith('cs_'),
  amount_total: z.number().int().nullable(),
  currency: z.string().nullable(),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  payment_intent: z.string().nullable(),
});

const eventSchema = z.object({
  id: z.string().startsWith('evt_'),
  type: z.string(),
  created: z.number().int(),
  livemode: z.boolean(),
  data: z.object({ object: z.unknown() }),
});

const HANDLED = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);

export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  fetch?: typeof fetch;
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly mode: 'test' | 'live';
  private readonly fetch: typeof fetch;

  constructor(private readonly options: StripeProviderOptions) {
    this.mode = options.secretKey.startsWith('sk_live_') ? 'live' : 'test';
    this.fetch = options.fetch ?? fetch;
  }

  async createCheckout(request: CheckoutRequest): Promise<Checkout> {
    const form = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': request.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(request.amountMinor),
      'line_items[0][price_data][product_data][name]': request.description.slice(0, 250),
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      client_reference_id: request.paymentId,
      'metadata[payment_id]': request.paymentId,
      'metadata[order_id]': request.orderId,
      // Stripe accepts expiry between 30 minutes and 24 hours from now.
      expires_at: String(
        Math.max(Math.floor(request.expiresAt.getTime() / 1000), Math.floor(Date.now() / 1000) + 1800),
      ),
    });
    const response = await this.fetch(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        // Retrying the same payment never creates a second session.
        'idempotency-key': `checkout-${request.paymentId}`,
      },
      body: form,
    });
    if (!response.ok) {
      throw new Error(`Stripe refused the checkout session (${response.status})`);
    }
    const session = z.object({ id: z.string(), url: z.url() }).parse(await response.json());
    return { checkoutId: session.id, url: session.url };
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): VerifiedWebhook {
    const header = headers[STRIPE_SIGNATURE_HEADER];
    const check = verifySignature(
      this.options.webhookSecret,
      rawBody,
      Array.isArray(header) ? header[0] : header,
    );
    if (!check.ok) throw new WebhookRejected(check.reason);
    const parsed = eventSchema.safeParse(parseJson(rawBody));
    if (!parsed.success) throw new WebhookRejected('unrecognised Stripe event');
    if (parsed.data.livemode !== (this.mode === 'live'))
      throw new WebhookRejected('event mode does not match the key');
    return {
      eventId: parsed.data.id,
      type: parsed.data.type,
      createdAt: new Date(parsed.data.created * 1000),
      payload: parsed.data,
    };
  }
}

/** Pure: a stored Stripe event as a ProviderEvent, or null for event types we do not act on. */
export function parseStripeEvent(payload: unknown): ProviderEvent | null {
  const event = eventSchema.safeParse(payload);
  if (!event.success || !HANDLED.has(event.data.type)) return null;
  const session = sessionObject.safeParse(event.data.data.object);
  if (!session.success) return null;
  const outcome: ProviderEvent['outcome'] = (() => {
    switch (event.data.type) {
      case 'checkout.session.completed':
        // Bank debits and similar methods complete later, through async_payment_*.
        return session.data.payment_status === 'paid' ? 'succeeded' : 'pending';
      case 'checkout.session.async_payment_succeeded':
        return 'succeeded';
      case 'checkout.session.async_payment_failed':
        return 'failed';
      default:
        return 'expired';
    }
  })();
  return {
    eventId: event.data.id,
    type: event.data.type,
    createdAt: new Date(event.data.created * 1000),
    checkoutId: session.data.id,
    outcome,
    amountMinor: session.data.amount_total,
    currency: session.data.currency?.toUpperCase() ?? null,
    providerPaymentId: session.data.payment_intent,
    failureCode: outcome === 'failed' ? 'async_payment_failed' : null,
  };
}
