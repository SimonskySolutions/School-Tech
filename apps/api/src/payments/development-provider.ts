import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  type Checkout,
  type CheckoutRequest,
  type PaymentProvider,
  type ProviderEvent,
  type VerifiedWebhook,
  WebhookRejected,
} from './provider';
import { parseJson, signPayload, verifySignature } from './signature';

// DEVELOPMENT PAYMENT PROVIDER: no money moves (ADR 0010). It stands in for a
// hosted checkout so the real flow can run end to end: a checkout page
// (served by the API under /dev-payments, development only) and signed,
// asynchronous webhook events to the same endpoint a real provider would call.

export const DEV_SIGNATURE_HEADER = 'pythagoras-dev-signature';

/** Everything the simulated checkout needs, carried in a signed token instead of stored state. */
const tokenSchema = z.object({
  v: z.literal(1),
  paymentId: z.uuid(),
  orderId: z.uuid(),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  description: z.string().max(300),
  successUrl: z.url(),
  cancelUrl: z.url(),
  expiresAt: z.number().int(),
});
export type DevCheckoutToken = z.infer<typeof tokenSchema>;

const eventSchema = z.object({
  id: z.string().startsWith('dev_evt_'),
  type: z.enum(['checkout.completed', 'checkout.failed', 'checkout.expired']),
  created: z.number().int(),
  data: z.object({
    checkout_id: z.string().startsWith('dev_cs_'),
    payment_id: z.uuid(),
    amount_minor: z.number().int(),
    currency: z.string(),
    failure_code: z.string().nullable(),
  }),
});
export type DevEvent = z.infer<typeof eventSchema>;

export interface DevelopmentProviderOptions {
  secret: string;
  /** Public base URL of the simulated checkout pages, e.g. http://api.pythagoras.localhost:53000. */
  publicUrl: string;
}

const derive = (secret: string, purpose: string) =>
  createHmac('sha256', secret).update(purpose).digest('hex');

export function checkoutIdFor(token: string): string {
  return `dev_cs_${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
}

export class DevelopmentPaymentProvider implements PaymentProvider {
  readonly name = 'development' as const;
  readonly mode = 'test' as const;
  private readonly tokenKey: string;
  private readonly webhookKey: string;

  constructor(private readonly options: DevelopmentProviderOptions) {
    this.tokenKey = derive(options.secret, 'checkout-token');
    this.webhookKey = derive(options.secret, 'webhook-signature');
  }

  createCheckout(request: CheckoutRequest): Promise<Checkout> {
    const body = Buffer.from(
      JSON.stringify({
        v: 1,
        paymentId: request.paymentId,
        orderId: request.orderId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        description: request.description.slice(0, 300),
        successUrl: request.successUrl,
        cancelUrl: request.cancelUrl,
        expiresAt: Math.floor(request.expiresAt.getTime() / 1000),
      } satisfies DevCheckoutToken),
    ).toString('base64url');
    const token = `${body}.${createHmac('sha256', this.tokenKey).update(body).digest('base64url')}`;
    return Promise.resolve({
      checkoutId: checkoutIdFor(token),
      url: `${this.options.publicUrl}/dev-payments/checkout/${token}`,
    });
  }

  /** Reads a checkout token from the simulated checkout page; null if forged or malformed. */
  readToken(token: string): DevCheckoutToken | null {
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    const expected = createHmac('sha256', this.tokenKey).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const parsed = tokenSchema.safeParse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** Builds and signs the event the simulated provider sends after the checkout page is used. */
  buildEvent(
    token: string,
    claims: DevCheckoutToken,
    outcome: 'succeeded' | 'failed',
    created = Math.floor(Date.now() / 1000),
  ): { body: string; signature: string } {
    const event: DevEvent = {
      id: `dev_evt_${randomUUID()}`,
      type: outcome === 'succeeded' ? 'checkout.completed' : 'checkout.failed',
      created,
      data: {
        checkout_id: checkoutIdFor(token),
        payment_id: claims.paymentId,
        amount_minor: claims.amountMinor,
        currency: claims.currency,
        failure_code: outcome === 'failed' ? 'card_declined' : null,
      },
    };
    const body = JSON.stringify(event);
    return { body, signature: signPayload(this.webhookKey, body, created) };
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): VerifiedWebhook {
    const header = headers[DEV_SIGNATURE_HEADER];
    const check = verifySignature(this.webhookKey, rawBody, Array.isArray(header) ? header[0] : header);
    if (!check.ok) throw new WebhookRejected(check.reason);
    const parsed = eventSchema.safeParse(parseJson(rawBody));
    if (!parsed.success) throw new WebhookRejected('unrecognised development event');
    return {
      eventId: parsed.data.id,
      type: parsed.data.type,
      createdAt: new Date(parsed.data.created * 1000),
      payload: parsed.data,
    };
  }
}

/** Pure: a stored development event as a ProviderEvent (used by the worker). */
export function parseDevelopmentEvent(payload: unknown): ProviderEvent | null {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { data } = parsed.data;
  return {
    eventId: parsed.data.id,
    type: parsed.data.type,
    createdAt: new Date(parsed.data.created * 1000),
    checkoutId: data.checkout_id,
    outcome:
      parsed.data.type === 'checkout.completed'
        ? 'succeeded'
        : parsed.data.type === 'checkout.failed'
          ? 'failed'
          : 'expired',
    amountMinor: data.amount_minor,
    currency: data.currency,
    providerPaymentId: `dev_pi_${data.payment_id}`,
    failureCode: data.failure_code,
  };
}
