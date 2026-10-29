import { type NestExpressApplication } from '@nestjs/platform-express';

/** HTTP settings shared by the real server (main.ts) and tests. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  return app;
}
