import { z } from 'zod';

// Web server configuration. Development defaults match compose.yaml;
// production must set every URL and secret, and must use HTTPS.

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url().default('http://localhost:53000'),
    API_INTERNAL_URL: z.url().default('http://api:3000'),
    OIDC_ISSUER: z.url().default('http://localhost:58080/realms/pythagoras'),
    OIDC_INTERNAL_URL: z.url().default('http://keycloak:8080/realms/pythagoras'),
    OIDC_CLIENT_ID: z.string().min(1).default('pythagoras-web'),
    OIDC_CLIENT_SECRET: z.string().min(16, 'OIDC_CLIENT_SECRET is required'),
    SESSION_SECRET: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'SESSION_SECRET must be 32 bytes as 64 hex characters'),
  })
  .superRefine((config, ctx) => {
    if (config.NODE_ENV === 'production') {
      for (const key of ['APP_URL', 'OIDC_ISSUER'] as const) {
        if (!config[key].startsWith('https://')) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'must use https in production' });
        }
      }
    }
  });

export type WebConfig = z.infer<typeof schema> & { readonly secureCookies: boolean };

const FILE_BACKED = ['OIDC_CLIENT_SECRET', 'SESSION_SECRET'] as const;

export function loadWebConfig(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string,
): WebConfig {
  const resolved: Record<string, string | undefined> = { ...env };
  for (const name of FILE_BACKED) {
    const file = env[`${name}_FILE`];
    if (file && !env[name]) resolved[name] = readFile(file).trim();
  }
  const result = schema.safeParse(resolved);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`invalid web configuration:\n  ${problems.join('\n  ')}`);
  }
  return { ...result.data, secureCookies: result.data.APP_URL.startsWith('https://') };
}
