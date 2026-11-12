import { parseDevelopmentEvent } from './development-provider';
import { type ProviderEvent, type ProviderName } from './provider';
import { parseStripeEvent } from './stripe-provider';

/** Turns a stored, already verified webhook payload into a ProviderEvent (null: not one we act on). */
export function parseProviderEvent(provider: ProviderName, payload: unknown): ProviderEvent | null {
  return provider === 'stripe' ? parseStripeEvent(payload) : parseDevelopmentEvent(payload);
}
