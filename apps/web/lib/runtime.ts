import { readFileSync } from 'node:fs';
import type * as client from 'openid-client';
import { loadWebConfig, type WebConfig } from './config';
import { oidcConfiguration } from './oidc';
import { keyFromSecret } from './session';

// Configuration, session key and OpenID client, created once per server process.
// Used by route handlers, server components (through lib/server.ts) and the proxy.

let cached: { config: WebConfig; key: Uint8Array; oidc: client.Configuration } | undefined;

export function runtime() {
  if (!cached) {
    const config = loadWebConfig(process.env, (path) => readFileSync(path, 'utf8'));
    cached = { config, key: keyFromSecret(config.SESSION_SECRET), oidc: oidcConfiguration(config) };
  }
  return cached;
}
