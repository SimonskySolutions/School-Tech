import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { type Request } from 'express';
import { Public } from '../auth/principal';
import { Database } from '../database/database';
import { PAYMENT_PROVIDER, type PaymentProvider, WebhookRejected } from './provider';

// Payment provider webhooks. The signature is checked against the raw request
// body; a verified event is stored and acknowledged, nothing more. The worker
// confirms payments from stored events (ADR 0010), so a slow or failing
// confirmation never makes the provider retry, and duplicates are harmless.

@Public()
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(Database) private readonly database: Database,
  ) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') name: string,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ received: true; duplicate: boolean }> {
    if (name !== this.provider.name) throw new NotFoundException();
    if (!request.rawBody) throw new BadRequestException('empty body');

    let verified;
    try {
      verified = this.provider.verifyWebhook(request.rawBody, request.headers);
    } catch (error) {
      if (error instanceof WebhookRejected || error instanceof SyntaxError) {
        this.logger.warn(`${name} webhook rejected: ${error.message}`);
        throw new BadRequestException('invalid webhook');
      }
      throw error;
    }

    const stored = await this.database.storeVerifiedEvent({
      provider: this.provider.name,
      mode: this.provider.mode,
      ...verified,
    });
    return { received: true, duplicate: stored === 'duplicate' };
  }
}
