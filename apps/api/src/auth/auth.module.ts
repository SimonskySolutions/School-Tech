import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { ENV } from '../config/config.module';
import { type Env } from '../config/env';
import { AuthGuard } from './auth.guard';
import { TokenVerifier } from './token-verifier';

@Module({
  providers: [
    {
      provide: TokenVerifier,
      inject: [ENV],
      useFactory: (env: Env) =>
        new TokenVerifier({
          issuer: env.OIDC_ISSUER,
          audience: env.OIDC_AUDIENCE,
          allowedClients: env.OIDC_ALLOWED_CLIENTS,
          // Keys are fetched lazily, cached, and refreshed when an unknown key id appears.
          keys: createRemoteJWKSet(new URL(env.OIDC_JWKS_URL), {
            cooldownDuration: 30_000,
            timeoutDuration: 5_000,
          }),
        }),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
