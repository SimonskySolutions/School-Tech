import { renderMessage } from '../notifications/templates';
import { type SystemDatabase } from '../database/system-database';
import { type MailTransport } from './mail-transport';

// Sends queued messages (ADR 0031). Each round claims due messages with a
// lease, so two workers never send the same one at once; a message whose
// worker stopped mid-send becomes due again when its lease runs out and is
// sent with the same Message-ID. Failures are retried by the database's
// schedule and end as "failed", kept to be seen.

export interface SenderLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface SenderOptions {
  intervalMs: number;
  batchSize: number;
  from: string;
  portalUrl: string;
  /** The domain in Message-IDs. */
  messageIdDomain: string;
}

interface ClaimedRow {
  id: string;
  kind_code: string;
  params: unknown;
  attempts: number;
  email: string;
  given_name: string;
  family_name: string;
}

/** A reason short enough to keep and free of message content: the error's code or first line. */
export function failureReason(error: unknown): string {
  const code = (error as { code?: unknown; responseCode?: unknown } | null)?.code;
  const response = (error as { responseCode?: unknown } | null)?.responseCode;
  const first = error instanceof Error ? (error.message.split('\n')[0] ?? '') : 'unknown error';
  return [
    typeof code === 'string' ? code : null,
    typeof response === 'number' ? `SMTP ${response}` : null,
    first,
  ]
    .filter(Boolean)
    .join(': ')
    .slice(0, 300);
}

export class NotificationSender {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly database: SystemDatabase,
    private readonly transport: MailTransport,
    private readonly logger: SenderLogger,
    private readonly options: SenderOptions,
  ) {}

  async sendOnce(): Promise<{ sent: number; failed: number }> {
    const claimed = await this.database.withSystem('worker:notifications', (tx) =>
      tx.query<ClaimedRow>(
        `SELECT id, kind_code, params, attempts, email, given_name, family_name
           FROM notify.claim_messages($1, interval '2 minutes')`,
        [this.options.batchSize],
      ),
    );
    const result = { sent: 0, failed: 0 };
    for (const message of claimed) {
      try {
        const rendered = renderMessage(
          message.kind_code,
          message.params,
          { givenName: message.given_name, familyName: message.family_name },
          this.options.portalUrl,
        );
        await this.transport.send({
          from: this.options.from,
          to: message.email,
          subject: rendered.subject,
          text: rendered.text,
          messageId: `<${message.id}@${this.options.messageIdDomain}>`,
        });
        await this.database.withSystem('worker:notifications', (tx) =>
          tx.query('SELECT notify.mark_sent($1)', [message.id]),
        );
        result.sent += 1;
      } catch (error) {
        const reason = failureReason(error);
        const [row] = await this.database.withSystem('worker:notifications', (tx) =>
          tx.query<{ status: string | null }>('SELECT notify.mark_attempt_failed($1, $2) AS status', [
            message.id,
            reason,
          ]),
        );
        result.failed += 1;
        this.logger.warn(
          `message ${message.id} (${message.kind_code}) not sent, now ${row?.status ?? '?'}: ${reason}`,
        );
      }
    }
    if (result.sent > 0) this.logger.log(`${result.sent} message(s) sent`);
    return result;
  }

  start(): void {
    const tick = () => {
      this.running = this.sendOnce()
        .catch((error: unknown) => this.logger.warn(`sending messages failed: ${failureReason(error)}`))
        .finally(() => {
          this.timer = setTimeout(tick, this.options.intervalMs);
        });
    };
    tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
