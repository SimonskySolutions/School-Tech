import { Logger, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { type Env } from '../config/env';
import { AccountsController } from './accounts.controller';
import { ACCOUNT_DIRECTORY, type AccountDirectory, KeycloakDirectory } from './keycloak-directory';

export function createAccountDirectory(env: Env): AccountDirectory | null {
  if (!env.PROVISIONING_CLIENT_SECRET) {
    new Logger('Accounts').warn('PROVISIONING_CLIENT_SECRET not set: sign-in accounts cannot be created');
    return null;
  }
  return new KeycloakDirectory({
    baseUrl: env.KEYCLOAK_ADMIN_URL,
    realm: env.KEYCLOAK_REALM,
    clientId: env.PROVISIONING_CLIENT_ID,
    clientSecret: env.PROVISIONING_CLIENT_SECRET,
    setup: env.ACCOUNT_SETUP,
  });
}

@Module({
  controllers: [AccountsController],
  providers: [{ provide: ACCOUNT_DIRECTORY, inject: [ENV], useFactory: createAccountDirectory }],
})
export class AccountsModule {}
