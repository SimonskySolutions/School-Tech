import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { SchoolsController } from './org/schools.controller';
import { MeController } from './people/me.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule],
  controllers: [HealthController, MeController, SchoolsController],
})
export class AppModule {}
