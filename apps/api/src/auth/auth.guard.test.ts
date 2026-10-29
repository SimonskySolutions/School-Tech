import { Test } from '@nestjs/testing';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApp } from '../configure-app';
import { Database, type PersonTransaction, type RequestContext } from '../database/database';
import { createTestIssuer, TEST_AUDIENCE, TEST_ISSUER } from './test-keys';
import { TokenVerifier } from './token-verifier';

const ANNA_SUBJECT = 'f1000000-0000-7000-8000-000000000020';
const ANNA_PERSON = 'c1000000-0000-7000-8000-000000000020';

/** Stands in for PostgreSQL: records the context each transaction ran with. */
class FakeDatabase {
  contexts: RequestContext[] = [];
  resolveLogin(_provider: string, subject: string) {
    return Promise.resolve(subject === ANNA_SUBJECT ? ANNA_PERSON : null);
  }
  withPerson<T>(context: RequestContext, work: (tx: PersonTransaction) => Promise<T>): Promise<T> {
    this.contexts.push(context);
    const tx: PersonTransaction = {
      query: <Row>(sql: string) =>
        Promise.resolve(
          (sql.includes('FROM people.person') && !sql.includes('guardian')
            ? [
                {
                  id: ANNA_PERSON,
                  given_name: 'Anna',
                  family_name: 'Ivanova',
                  preferred_name: null,
                  email: null,
                },
              ]
            : []) as Row[],
        ),
    };
    return work(tx);
  }
  ping() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

describe('AuthGuard', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let issuer: Awaited<ReturnType<typeof createTestIssuer>>;
  const database = new FakeDatabase();

  beforeAll(async () => {
    issuer = await createTestIssuer();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Database)
      .useValue(database)
      .overrideProvider(TokenVerifier)
      .useValue(
        new TokenVerifier({
          issuer: TEST_ISSUER,
          audience: TEST_AUDIENCE,
          allowedClients: ['pythagoras-web'],
          keys: issuer.keys,
        }),
      )
      .compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: false }));
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${baseUrl}${path}`, { headers });

  it('refuses a request without a token (401)', async () => {
    expect((await get('/me')).status).toBe(401);
  });

  it('refuses a malformed authorization header (401)', async () => {
    expect((await get('/me', { authorization: 'Basic YWRtaW46YWRtaW4=' })).status).toBe(401);
    expect((await get('/me', { authorization: 'Bearer' })).status).toBe(401);
  });

  it('refuses an invalid token (401) without saying why', async () => {
    const response = await get('/me', { authorization: `Bearer ${await issuer.sign({ aud: 'other' })}` });
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain('aud');
  });

  it('refuses a valid token whose subject has no person (403)', async () => {
    const token = await issuer.sign({ sub: 'f1000000-0000-7000-8000-000000000023' });
    expect((await get('/me', { authorization: `Bearer ${token}` })).status).toBe(403);
  });

  it('runs the request as the linked person, with the request id', async () => {
    const response = await get('/me', {
      authorization: `Bearer ${await issuer.sign()}`,
      'x-request-id': 'req-test-0001',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req-test-0001');
    const body = (await response.json()) as { person: { id: string } };
    expect(body.person.id).toBe(ANNA_PERSON);
    expect(database.contexts.at(-1)).toEqual({
      personId: ANNA_PERSON,
      subject: ANNA_SUBJECT,
      clientId: 'pythagoras-web',
      requestId: 'req-test-0001',
    });
  });

  it('replaces a request id that is not well-formed', async () => {
    const response = await get('/health/live', { 'x-request-id': 'bad id with spaces' });
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('leaves health checks public', async () => {
    expect((await get('/health/live')).status).toBe(200);
    expect((await get('/health/ready')).status).toBe(200);
  });
});
