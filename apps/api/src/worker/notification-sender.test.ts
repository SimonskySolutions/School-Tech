import { describe, expect, it } from 'vitest';
import { type SystemDatabase, type SystemTransaction } from '../database/system-database';
import { messageParams, renderMessage } from '../notifications/templates';
import { type MailTransport, type OutgoingMail } from './mail-transport';
import { failureReason, NotificationSender } from './notification-sender';
import { loadWorkerEnv } from './worker-env';

const MESSAGE = '01a19900-0000-7000-8000-000000000001';
const GROUP = '01a19900-0000-7000-8000-0000000000aa';
const paid = { orderNumber: 'PY-00001234', totalMinor: 1240, currency: 'EUR', checkoutGroupId: GROUP };

function fakeDatabase(claimed: object[]) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const database = {
    withSystem: <T>(_actor: string, work: (tx: SystemTransaction) => Promise<T>) =>
      work({
        query: <Row>(sql: string, params: readonly unknown[] = []) => {
          calls.push({ sql, params });
          if (sql.includes('claim_messages')) return Promise.resolve(claimed as Row[]);
          if (sql.includes('mark_attempt_failed')) return Promise.resolve([{ status: 'queued' }] as Row[]);
          return Promise.resolve([] as Row[]);
        },
      }),
  } as unknown as SystemDatabase;
  return { database, calls };
}

const transport = (fail?: Error) => {
  const sent: OutgoingMail[] = [];
  const mail: MailTransport = {
    send: (message) => (fail ? Promise.reject(fail) : Promise.resolve(void sent.push(message))),
    close: () => undefined,
  };
  return { mail, sent };
};
const logger = { log: () => undefined, warn: () => undefined };
const options = {
  intervalMs: 1000,
  batchSize: 20,
  from: 'Pythagoras <no-reply@example.test>',
  portalUrl: 'https://portal.example.test/',
  messageIdDomain: 'portal.example.test',
};
const row = (params: unknown) => ({
  id: MESSAGE,
  kind_code: 'order.paid',
  params,
  attempts: 0,
  email: 'anna@example.test',
  given_name: 'Anna',
  family_name: 'Ivanova',
});

describe('messages', () => {
  it('say what happened and link to the portal, nothing more', () => {
    const rendered = renderMessage(
      'order.paid',
      paid,
      { givenName: 'Anna', familyName: 'Ivanova' },
      'https://portal.example.test/',
    );
    expect(rendered.subject).toBe('Payment received: order PY-00001234');
    expect(rendered.text).toContain('Dear Anna Ivanova,');
    expect(rendered.text).toContain('for order PY-00001234');
    expect(rendered.text).toContain(`https://portal.example.test/orders/${GROUP}`);
    expect(() => messageParams('order.paid', { ...paid, allergy: 'peanuts' })).toThrow();
    expect(() => renderMessage('order.lost', paid, { givenName: 'A', familyName: 'B' }, 'x')).toThrow(
      'no template',
    );
  });

  it('are sent with the same Message-ID on every attempt, then marked sent', async () => {
    const { database, calls } = fakeDatabase([row(paid)]);
    const { mail, sent } = transport();
    expect(await new NotificationSender(database, mail, logger, options).sendOnce()).toEqual({
      sent: 1,
      failed: 0,
    });
    expect(sent).toEqual([
      expect.objectContaining({
        to: 'anna@example.test',
        from: 'Pythagoras <no-reply@example.test>',
        messageId: `<${MESSAGE}@portal.example.test>`,
      }),
    ]);
    expect(calls.map((call) => call.sql)).toContain('SELECT notify.mark_sent($1)');
  });

  it('are retried when the mail service fails, with a short reason and no content', async () => {
    const { database, calls } = fakeDatabase([row(paid)]);
    const refused = Object.assign(new Error('Message rejected\nDear Anna Ivanova, we have received'), {
      code: 'EENVELOPE',
      responseCode: 550,
    });
    const { mail } = transport(refused);
    expect(await new NotificationSender(database, mail, logger, options).sendOnce()).toEqual({
      sent: 0,
      failed: 1,
    });
    const failed = calls.find((call) => call.sql.includes('mark_attempt_failed'))!;
    expect(failed.params).toEqual([MESSAGE, 'EENVELOPE: SMTP 550: Message rejected']);
    expect(failureReason(new Error('x'.repeat(400)))).toHaveLength(300);
  });

  it('whose parameters no longer fit their template are not sent', async () => {
    const { database, calls } = fakeDatabase([row({ orderNumber: 'unknown' })]);
    const { mail, sent } = transport();
    expect(await new NotificationSender(database, mail, logger, options).sendOnce()).toEqual({
      sent: 0,
      failed: 1,
    });
    expect(sent).toEqual([]);
    expect(calls.some((call) => call.sql.includes('mark_attempt_failed'))).toBe(true);
  });
});

describe('mail settings', () => {
  const production = {
    NODE_ENV: 'production',
    DB_HOST: 'db',
    DB_PASSWORD: 'x',
    REDIS_HOST: 'redis',
    REDIS_PASSWORD: 'x',
    DB_SSL_ROOT_CERT: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    REDIS_TLS_CA: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
  };

  it('use the development mailbox in development', () => {
    expect(loadWorkerEnv({}, () => '')).toMatchObject({
      SMTP_HOST: 'mailpit',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
    });
  });

  it('refuse the development mailbox, plain connections and development addresses in production', () => {
    expect(() => loadWorkerEnv(production, () => '')).toThrow(
      /SMTP_HOST: the development mailbox[\s\S]*SMTP_REQUIRE_TLS[\s\S]*MAIL_FROM[\s\S]*PORTAL_URL/,
    );
    const env = loadWorkerEnv(
      {
        ...production,
        SMTP_HOST: 'smtp.provider.example',
        SMTP_PORT: '587',
        SMTP_REQUIRE_TLS: 'true',
        SMTP_USER: 'apikey',
        SMTP_PASSWORD_FILE: '/run/secrets/smtp',
        MAIL_FROM: 'Pythagoras <no-reply@pythagoras.example>',
        PORTAL_URL: 'https://portal.pythagoras.example',
      },
      () => 'secret\n',
    );
    expect(env).toMatchObject({ SMTP_REQUIRE_TLS: true, SMTP_PASSWORD: 'secret' });
  });
});
