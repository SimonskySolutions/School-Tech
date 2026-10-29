import { Test } from '@nestjs/testing';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../configure-app';

describe('GET /health/live', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the API as live, with the active payment provider', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', service: 'api', paymentProvider: 'development' });
  });

  it('does not advertise the framework', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('answers unknown routes with 404', async () => {
    const response = await fetch(`${baseUrl}/no-such-route`);
    expect(response.status).toBe(404);
  });
});
