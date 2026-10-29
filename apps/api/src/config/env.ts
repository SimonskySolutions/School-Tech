import { z } from 'zod';

// The API refuses to start with an incomplete or unsafe configuration. Secrets
// arrive as environment variables or *_FILE paths (Docker secrets) and are never
// logged.

const paymentProvider = z.enum(['development', 'stripe']);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // ADR 0010: payments run on the labelled development provider until Stripe keys exist.
    PAYMENT_PROVIDER: paymentProvider.default('development'),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'stripe') {
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENT_PROVIDER'],
          message: 'stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET',
        });
      }
      if (env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && env.NODE_ENV !== 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_SECRET_KEY'],
          message: 'a live Stripe key is only allowed in production',
        });
      }
    }
    if (env.PAYMENT_PROVIDER === 'development' && env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'the development payment provider cannot run in production',
      });
    }
  });

export type Env = z.infer<typeof schema>;

export interface EnvSource {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readFile: (path: string) => string;
}

const FILE_BACKED = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;

/** Resolves NAME_FILE variables (Docker secrets) into NAME, then validates. */
export function loadEnv({ env, readFile }: EnvSource): Env {
  const resolved: Record<string, string | undefined> = { ...env };
  for (const name of FILE_BACKED) {
    const file = env[`${name}_FILE`];
    if (file && !env[name]) {
      resolved[name] = readFile(file).trim();
    }
  }
  const result = schema.safeParse(resolved);
  if (!result.success) {
    // Only paths and messages: values may be secrets.
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`invalid API configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
