import { type NestExpressApplication } from '@nestjs/platform-express';
import { requestId } from './auth/request-id.middleware';

/** HTTP settings shared by the real server (main.ts) and tests. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.disable('x-powered-by');
  app.use(requestId);
  app.enableShutdownHooks();
  return app;
}
