import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CatalogController } from './catalog/catalog.controller';
import { DietaryController, DietaryReviewController } from './dietary/dietary.controller';
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
import { CMS_WEBSITES, CmsWebsitesClient } from './onboarding/cms-websites';
import { ENV } from './config/config.module';
import { type Env } from './config/env';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, PaymentsModule, AccountsModule],
  controllers: [
    HealthController,
    MeController,
    SchoolsController,
    TlsController,
    SitesController,
    CatalogController,
    DietaryController,
    DietaryReviewController,
    CheckoutController,
    WebhookController,
    DevCheckoutController,
    SchoolLifeController,
    ReportsController,
    OnboardingController,
    FamiliesController,
  ],
  providers: [
    CheckoutService,
    {
      provide: CMS_WEBSITES,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.CMS_PLATFORM_API_KEY
          ? new CmsWebsitesClient(env.CMS_INTERNAL_URL, env.CMS_PLATFORM_API_KEY)
          : null,
    },
  ],
})
export class AppModule {}
