import { Controller, Get, Inject } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { type Env } from '../config/env';

export interface LiveStatus {
  status: 'ok';
  service: 'api';
  paymentProvider: Env['PAYMENT_PROVIDER'];
}

// Liveness only: the process is up and configured. Readiness (database and
// Redis reachable) arrives with the data access layer in M1.3.
@Controller('health')
export class HealthController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('live')
  live(): LiveStatus {
    return { status: 'ok', service: 'api', paymentProvider: this.env.PAYMENT_PROVIDER };
  }
}
