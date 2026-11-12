// The payment provider port (ADR 0010). Business code talks to this interface
// only; the development and Stripe adapters implement it. Webhook payloads are
// verified here, stored by the API, and turned into ProviderEvents by the
// worker with the pure parse functions (no keys needed there).

export type ProviderName = 'development' | 'stripe';
export type ProviderMode = 'test' | 'live';

export interface CheckoutRequest {
  paymentId: string;
  orderId: string;
  groupId: string;
  amountMinor: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface Checkout {
  checkoutId: string;
  url: string;
}

/** A provider event reduced to what confirmation needs. */
export interface ProviderEvent {
  eventId: string;
  type: string;
  createdAt: Date;
  checkoutId: string;
  outcome: 'succeeded' | 'failed' | 'expired' | 'pending';
  amountMinor: number | null;
  currency: string | null;
  providerPaymentId: string | null;
  failureCode: string | null;
}

/** A webhook whose signature verified, ready to be stored. */
export interface VerifiedWebhook {
  eventId: string;
  type: string;
  createdAt: Date;
  payload: unknown;
}

export class WebhookRejected extends Error {}

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly mode: ProviderMode;
  createCheckout(request: CheckoutRequest): Promise<Checkout>;
  verifyWebhook(
    rawBody: Buffer,
    headers: Readonly<Record<string, string | string[] | undefined>>,
  ): VerifiedWebhook;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
