import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import { type Env } from './config/env';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule));
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
  Logger.log(`API listening on port ${env.PORT} (payments: ${env.PAYMENT_PROVIDER})`, 'Bootstrap');
}

void bootstrap();
