import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/principal';
import { ENV } from '../config/config.module';
import { type Env } from '../config/env';
import { Database } from '../database/database';

export interface LiveStatus {
  status: 'ok';
  service: 'api';
  paymentProvider: Env['PAYMENT_PROVIDER'];
}

@Public()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(Database) private readonly database: Database,
  ) {}

  /** The process is up and configured. */
  @Get('live')
  live(): LiveStatus {
    return { status: 'ok', service: 'api', paymentProvider: this.env.PAYMENT_PROVIDER };
  }

  /** The API can serve requests: PostgreSQL answers. */
  @Get('ready')
  @HttpCode(200)
  async ready(): Promise<{ status: 'ready' }> {
    try {
      await this.database.ping();
    } catch {
      throw new ServiceUnavailableException('database unavailable');
    }
    return { status: 'ready' };
  }
}
