import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CatalogController } from './catalog/catalog.controller';
import { CheckoutController } from './commerce/checkout.controller';
import { CheckoutService } from './commerce/checkout.service';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { SchoolsController } from './org/schools.controller';
import { TlsController } from './org/tls.controller';
import { DevCheckoutController } from './payments/dev-checkout.controller';
import { PaymentsModule } from './payments/payments.module';
import { WebhookController } from './payments/webhook.controller';
import { MeController } from './people/me.controller';
import { SchoolLifeController } from './school-life/school-life.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, PaymentsModule],
  controllers: [
    HealthController,
    MeController,
    SchoolsController,
    TlsController,
    CatalogController,
    CheckoutController,
    WebhookController,
    DevCheckoutController,
    SchoolLifeController,
  ],
  providers: [CheckoutService],
})
export class AppModule {}
