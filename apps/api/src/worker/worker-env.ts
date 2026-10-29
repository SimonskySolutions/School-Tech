import { z } from 'zod';

// Worker configuration. Development defaults match compose.yaml; production
// must set hosts and secrets explicitly.

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DB_HOST: z.string().min(1).optional(),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
    DB_NAME: z.string().min(1).default('pythagoras'),
    DB_USER: z.string().min(1).default('pyth_worker'),
    DB_PASSWORD: z.string().min(1).optional(),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    REDIS_HOST: z.string().min(1).optional(),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
    REDIS_USERNAME: z.string().min(1).default('pyth_queue'),
    REDIS_PASSWORD: z.string().min(1).optional(),
    QUEUE_PREFIX: z
      .string()
      .regex(/^pyth(:[a-z0-9-]+)?$/)
      .default('pyth'),
    OUTBOX_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
    EVENT_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
    HEARTBEAT_FILE: z.string().min(1).default('/tmp/worker-heartbeat'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const key of ['DB_HOST', 'DB_PASSWORD', 'REDIS_HOST', 'REDIS_PASSWORD'] as const) {
        if (env[key] === undefined)
          ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
      }
    }
  })
  .transform((env) => ({
    ...env,
    DB_HOST: env.DB_HOST ?? 'postgres',
    REDIS_HOST: env.REDIS_HOST ?? 'redis',
  }));

export type WorkerEnv = z.infer<typeof schema>;

const FILE_BACKED = ['DB_PASSWORD', 'REDIS_PASSWORD'] as const;

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
