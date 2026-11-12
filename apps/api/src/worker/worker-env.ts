import { z } from 'zod';

// Worker configuration. Development defaults match compose.yaml; production
// must set hosts and secrets explicitly.

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DB_HOST: z.string().min(1).optional(),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().min(1).default('pythagoras'),
    DB_USER: z.string().min(1).default('pyth_worker'),
    DB_PASSWORD: z.string().min(1).optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    // M8.4: certificate authorities for TLS to the database (PgBouncer) and to
    // Redis; when set, the server's certificate and name are verified.
    DB_SSL_ROOT_CERT: z.string().includes('BEGIN CERTIFICATE').optional(),
    REDIS_HOST: z.string().min(1).optional(),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_USERNAME: z.string().min(1).default('pyth_queue'),
    REDIS_PASSWORD: z.string().min(1).optional(),
    REDIS_TLS_CA: z.string().includes('BEGIN CERTIFICATE').optional(),
    QUEUE_PREFIX: z
      .string()
      .regex(/^pyth(:[a-z0-9-]+)?$/)
      .default('pyth'),
    OUTBOX_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    EVENT_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    HEARTBEAT_FILE: z.string().min(1).default('/tmp/worker-heartbeat'),
    // The platform's measures for Prometheus (M8.6); 0 turns the endpoint off.
    METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),

    // Messages by e-mail (ADR 0031): any SMTP service; Mailpit in development.
    SMTP_HOST: z.string().min(1).default('mailpit'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: flag.default(false),
    SMTP_REQUIRE_TLS: flag.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM: z
      .string()
      .regex(
        /^[^<>@]*<[^<>@\s]+@([a-z0-9-]+\.)+[a-z]{2,}>$|^[^<>@\s]+@([a-z0-9-]+\.)+[a-z]{2,}$/i,
        'an address, or "Name <address>"',
      )
      .default('Pythagoras <no-reply@pythagoras.localhost>'),
    // Where links in messages lead.
    PORTAL_URL: z.url().default('http://portal.pythagoras.localhost:53000'),
    NOTIFY_INTERVAL_MS: z.coerce.number().int().min(500).max(300_000).default(5000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const key of [
        'DB_HOST',
        'DB_PASSWORD',
        'DB_SSL_ROOT_CERT',
        'REDIS_HOST',
        'REDIS_PASSWORD',
        'REDIS_TLS_CA',
      ] as const) {
        if (env[key] === undefined)
          ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
      }
      // Never the development mailbox, never without TLS, never from a development domain.
      if (env.SMTP_HOST === 'mailpit') {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_HOST'],
          message: 'the development mailbox cannot be used in production',
        });
      }
      if (!env.SMTP_SECURE && !env.SMTP_REQUIRE_TLS) {
        ctx.addIssue({
          code: 'custom',
          path: ['SMTP_REQUIRE_TLS'],
          message: 'mail must be sent over TLS in production',
        });
      }
      if (/\.(localhost|test)>?$/i.test(env.MAIL_FROM)) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_FROM'],
          message: 'a development address cannot send in production',
        });
      }
      if (!env.PORTAL_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['PORTAL_URL'], message: 'must use https in production' });
      }
    }
  })
  .transform((env) => ({
    ...env,
    DB_HOST: env.DB_HOST ?? 'postgres',
    REDIS_HOST: env.REDIS_HOST ?? 'redis',
  }));

export type WorkerEnv = z.infer<typeof schema>;

const FILE_BACKED = [
  'DB_PASSWORD',
  'DB_SSL_ROOT_CERT',
  'REDIS_PASSWORD',
  'REDIS_TLS_CA',
  'SMTP_PASSWORD',
] as const;

export function loadWorkerEnv(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string,
): WorkerEnv {
  const resolved: Record<string, string | undefined> = { ...env };
  for (const name of FILE_BACKED) {
    const file = env[`${name}_FILE`];
    if (file && !env[name]) resolved[name] = readFile(file).trim();
  }
  const result = schema.safeParse(resolved);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`invalid worker configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
