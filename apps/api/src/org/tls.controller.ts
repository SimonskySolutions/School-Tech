import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/principal';
import { Database } from '../database/database';

// Asked by the production gateway before it requests an HTTPS certificate for
// a host name (Caddy on-demand TLS, ADR 0015). Only verified domains of live
// websites get certificates, so nobody can make the gateway obtain
// certificates for names we do not own. The gateway never routes /internal
// from outside; this endpoint is for the Compose network only.

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

@Public()
@Controller('internal/tls')
export class TlsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('allowed')
  @HttpCode(200)
  async allowed(@Query('domain') domain: unknown): Promise<{ allowed: true }> {
    const hostname = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
    if (!HOSTNAME.test(hostname)) {
      throw new BadRequestException('domain must be a host name');
    }
    if (!(await this.database.resolveHostname(hostname))) {
      throw new NotFoundException('not a verified domain of a live website');
    }
    return { allowed: true };
  }
}
