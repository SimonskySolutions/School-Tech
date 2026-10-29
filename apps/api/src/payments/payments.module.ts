import { randomBytes } from 'node:crypto';
import { Global, Logger, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { type Env } from '../config/env';
import { DevelopmentPaymentProvider } from './development-provider';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider';
import { StripePaymentProvider } from './stripe-provider';

export function createPaymentProvider(env: Env): PaymentProvider {
  if (env.PAYMENT_PROVIDER === 'stripe') {
    // Configuration validation guarantees both keys are present.
    return new StripePaymentProvider({
      secretKey: env.STRIPE_SECRET_KEY!,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET!,
    });
  }
  if (!env.DEV_PAYMENTS_SECRET) {
    new Logger('Payments').warn('DEV_PAYMENTS_SECRET not set: using a random secret for this process');
  }
  return new DevelopmentPaymentProvider({
    secret: env.DEV_PAYMENTS_SECRET ?? randomBytes(32).toString('hex'),
    publicUrl: env.DEV_PAYMENTS_PUBLIC_URL,
  });
}

@Global()
@Module({
  providers: [{ provide: PAYMENT_PROVIDER, inject: [ENV], useFactory: createPaymentProvider }],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentsModule {}
