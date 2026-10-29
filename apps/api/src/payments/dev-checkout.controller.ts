import {
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { formatMoney } from '@pythagoras/shared';
import { type Response } from 'express';
import { Public } from '../auth/principal';
import { ENV } from '../config/config.module';
import { type Env } from '../config/env';
import { DEV_SIGNATURE_HEADER, DevelopmentPaymentProvider } from './development-provider';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider';

// The development provider's "hosted checkout" (ADR 0010). It exists only when
// the development provider is active; with Stripe configured every route here
// answers 404. Choosing an outcome redirects the browser back immediately and
// sends the signed webhook a moment later, like a real provider: the portal
// must wait for the worker's confirmation, never trust the redirect.

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Public()
@Controller('dev-payments')
export class DevCheckoutController {
  private readonly logger = new Logger(DevCheckoutController.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get dev(): DevelopmentPaymentProvider {
    if (!(this.provider instanceof DevelopmentPaymentProvider) || this.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    return this.provider;
  }

  @Get('checkout/:token')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('cache-control', 'no-store')
  @Header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
  page(@Param('token') token: string): string {
    const claims = this.dev.readToken(token);
    if (!claims) throw new NotFoundException('unknown checkout');
    const expired = claims.expiresAt * 1000 < Date.now();
    const amount = escapeHtml(formatMoney(claims.amountMinor, claims.currency));
    const action = (outcome: string) => `/dev-payments/checkout/${escapeHtml(token)}/${outcome}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Development payment</title>
<meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;line-height:1.5">
<p style="background:#fff4ce;padding:.75rem;border-radius:4px" data-testid="dev-banner">
<strong>Development payment provider.</strong> No money moves and no card is needed.</p>
<h1>Pay ${amount}</h1>
<p>${escapeHtml(claims.description)}</p>
${expired ? '<p data-testid="expired"><strong>This checkout has expired.</strong></p>' : ''}
<form method="post" action="${action('succeed')}"><button type="submit" data-testid="pay">Simulate a successful payment</button></form>
<form method="post" action="${action('fail')}" style="margin-top:.5rem"><button type="submit" data-testid="fail">Simulate a declined card</button></form>
<p><a href="${escapeHtml(claims.cancelUrl)}" data-testid="abandon">Leave without paying</a></p>
</body></html>`;
  }

  @Post('checkout/:token/:outcome')
  @HttpCode(303)
  act(@Param('token') token: string, @Param('outcome') outcome: string, @Res() response: Response): void {
    const dev = this.dev;
    const claims = dev.readToken(token);
    if (!claims || (outcome !== 'succeed' && outcome !== 'fail')) throw new NotFoundException();

    const event = dev.buildEvent(token, claims, outcome === 'succeed' ? 'succeeded' : 'failed');
    // Deliver like a provider: shortly after, to the public webhook endpoint of this API.
    setTimeout(() => {
      fetch(`http://127.0.0.1:${this.env.PORT}/webhooks/development`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [DEV_SIGNATURE_HEADER]: event.signature },
        body: event.body,
      }).catch((error: unknown) =>
        this.logger.error(
          `development webhook delivery failed: ${error instanceof Error ? error.message : 'unknown'}`,
        ),
      );
    }, 1000);

    response.redirect(303, outcome === 'succeed' ? claims.successUrl : claims.cancelUrl);
  }
}
