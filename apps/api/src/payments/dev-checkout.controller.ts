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

// The portal's look (docs/design.md), inline: the page's policy allows no other request.
const CHECKOUT_STYLE = `*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;line-height:1.5;color:#121a33;
font-family:'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif;
background:radial-gradient(60% 60% at 15% 10%,rgb(84 128 255/35%),transparent 60%),radial-gradient(50% 50% at 90% 90%,rgb(11 158 145/25%),transparent 60%),#080e26}
.card{width:min(440px,100%);background:#fff;border-radius:22px;padding:30px;box-shadow:0 30px 80px -20px rgb(0 0 0/55%)}
.dev{margin:0 0 22px;padding:10px 14px;border-radius:12px;background:#fff6e0;color:#8a5a00;border:1px solid #f5d68f;font-size:.85rem}
.label{margin:0;font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5480ff}
h1{margin:4px 0 6px;font-size:2rem;letter-spacing:-.02em;color:#0e1738}
.what{margin:0 0 22px;color:#414b6b}
.expired{padding:10px 14px;border-radius:12px;background:#ffecf2;color:#a01d4d}
form{margin:0 0 10px}
button{width:100%;min-height:46px;border:0;border-radius:12px;font:inherit;font-weight:650;color:#fff;cursor:pointer;
background:linear-gradient(135deg,#5480ff,#2546db);box-shadow:0 6px 18px -8px rgb(47 91 245/70%)}
button.decline{background:#fff;color:#d6336c;border:1px solid #f3bfd1;box-shadow:none}
button:hover{filter:brightness(1.05)}
.leave{margin:16px 0 0;text-align:center}
a{color:#2f5bf5;font-weight:600;text-decoration:none}`;

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
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<style>${CHECKOUT_STYLE}</style></head>
<body><main class="card">
<p class="dev" data-testid="dev-banner"><strong>Development payment provider.</strong> No money moves and no card is needed.</p>
<p class="label">Pythagoras school group</p>
<h1>Pay ${amount}</h1>
<p class="what">${escapeHtml(claims.description)}</p>
${expired ? '<p class="expired" data-testid="expired"><strong>This checkout has expired.</strong></p>' : ''}
<form method="post" action="${action('succeed')}"><button type="submit" data-testid="pay">Simulate a successful payment</button></form>
<form method="post" action="${action('fail')}"><button type="submit" class="decline" data-testid="fail">Simulate a declined card</button></form>
<p class="leave"><a href="${escapeHtml(claims.cancelUrl)}" data-testid="abandon">Leave without paying</a></p>
</main></body></html>`;
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
