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
import { ReportsController } from './reporting/reports.controller';
import { OnboardingController } from './onboarding/onboarding.controller';
import { AccountsModule } from './accounts/accounts.module';
import { FamiliesController } from './families/families.controller';
import { SitesController } from './org/sites.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, PaymentsModule, AccountsModule],
  controllers: [
    HealthController,
    MeController,
    SchoolsController,
    TlsController,
    SitesController,
    CatalogController,
    CheckoutController,
    WebhookController,
    DevCheckoutController,
    SchoolLifeController,
    ReportsController,
    OnboardingController,
    FamiliesController,
  ],
  providers: [CheckoutService],
})
export class AppModule {}
