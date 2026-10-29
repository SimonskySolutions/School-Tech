import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { type Env } from '../config/env';
import { Database } from './database';

@Global()
@Module({
  providers: [
    {
      provide: Database,
      inject: [ENV],
      useFactory: (env: Env) =>
        new Database({
          host: env.DB_HOST,
          port: env.DB_PORT,
          database: env.DB_NAME,
          user: env.DB_USER,
          password: env.DB_PASSWORD,
          max: env.DB_POOL_MAX,
        }),
    },
  ],
  exports: [Database],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(Database) private readonly database: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
