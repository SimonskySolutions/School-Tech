import { createTransport } from 'nodemailer';

// The SMTP side of notifications (ADR 0031): any provider, or the group's own
// server; Mailpit in development. Only this file talks to the mail service.

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** The same on every attempt, so a repeat after a crash can be recognised. */
  messageId: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
  close(): void;
}

export interface SmtpSettings {
  host: string;
  port: number;
  /** Implicit TLS (usually port 465). */
  secure: boolean;
  /** STARTTLS required (usually port 587). */
  requireTls: boolean;
  user?: string;
  password?: string;
}

export function smtpTransport(settings: SmtpSettings): MailTransport {
  const transport = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTls,
    ...(settings.user ? { auth: { user: settings.user, pass: settings.password } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return {
    async send(mail) {
      await transport.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        messageId: mail.messageId,
      });
    },
    close: () => transport.close(),
  };
}
