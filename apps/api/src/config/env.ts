import { z } from 'zod';

// The API refuses to start with an incomplete or unsafe configuration. Secrets
// arrive as environment variables or *_FILE paths (Docker secrets) and are never
// logged. Development defaults match compose.yaml; production must set every
// connection value explicitly.

const DEV_TEST_CLIENT = 'pythagoras-dev-tests';

const DEVELOPMENT_DEFAULTS = {
  DB_HOST: 'postgres',
  OIDC_ISSUER: 'http://localhost:58080/realms/pythagoras',
  OIDC_JWKS_URL: 'http://keycloak:8080/realms/pythagoras/protocol/openid-connect/certs',
  OIDC_ALLOWED_CLIENTS: `pythagoras-web,${DEV_TEST_CLIENT}`,
} as const;

const list = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1)).min(1));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    DB_HOST: z.string().min(1).optional(),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().min(1).default('pythagoras'),
    DB_USER: z.string().min(1).default('pyth_api'),
    DB_PASSWORD: z.string().min(1).optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    OIDC_ISSUER: z.url().optional(),
    OIDC_JWKS_URL: z.url().optional(),
    OIDC_AUDIENCE: z.string().min(1).default('pythagoras-api'),
    OIDC_ALLOWED_CLIENTS: list.optional(),

    // Where parents return after checkout. Payment providers redirect only here.
    PORTAL_URL: z.url().default('http://portal.pythagoras.localhost:53000'),
    // How long a reservation is held while the parent pays.
    CHECKOUT_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),

    // ADR 0010: payments run on the labelled development provider until Stripe keys exist.
    PAYMENT_PROVIDER: z.enum(['development', 'stripe']).default('development'),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    // Development provider only: signs checkout tokens and webhooks. A random
    // one is generated per process when unset.
    DEV_PAYMENTS_SECRET: z.string().min(32).optional(),
    DEV_PAYMENTS_PUBLIC_URL: z.url().default('http://api.pythagoras.localhost:53000'),
  })
  .superRefine((env, ctx) => {
    const production = env.NODE_ENV === 'production';
    if (production) {
      for (const key of [
        'DB_HOST',
        'DB_PASSWORD',
        'OIDC_ISSUER',
        'OIDC_JWKS_URL',
        'OIDC_ALLOWED_CLIENTS',
      ] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
        }
      }
      if (!env.PORTAL_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['PORTAL_URL'], message: 'must use https in production' });
      }
      if (env.OIDC_ALLOWED_CLIENTS?.includes(DEV_TEST_CLIENT)) {
        ctx.addIssue({
          code: 'custom',
          path: ['OIDC_ALLOWED_CLIENTS'],
          message: `${DEV_TEST_CLIENT} is a development-only client`,
        });
      }
    }
    if (env.PAYMENT_PROVIDER === 'stripe') {
      if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['PAYMENT_PROVIDER'],
          message: 'stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET',
        });
      }
      if (env.STRIPE_SECRET_KEY?.startsWith('sk_live_') && !production) {
        ctx.addIssue({
          code: 'custom',
          path: ['STRIPE_SECRET_KEY'],
          message: 'a live Stripe key is only allowed in production',
        });
      }
    }
    if (env.PAYMENT_PROVIDER === 'development' && production) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER'],
        message: 'the development payment provider cannot run in production',
      });
    }
  })
  .transform((env) => ({
    ...env,
    DB_HOST: env.DB_HOST ?? DEVELOPMENT_DEFAULTS.DB_HOST,
    OIDC_ISSUER: env.OIDC_ISSUER ?? DEVELOPMENT_DEFAULTS.OIDC_ISSUER,
    OIDC_JWKS_URL: env.OIDC_JWKS_URL ?? DEVELOPMENT_DEFAULTS.OIDC_JWKS_URL,
    OIDC_ALLOWED_CLIENTS: env.OIDC_ALLOWED_CLIENTS ?? DEVELOPMENT_DEFAULTS.OIDC_ALLOWED_CLIENTS.split(','),
  }));

export type Env = z.infer<typeof schema>;

export interface EnvSource {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readFile: (path: string) => string;
}

const FILE_BACKED = [
  'DB_PASSWORD',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'DEV_PAYMENTS_SECRET',
] as const;

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
