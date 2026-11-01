import { formatMoney } from '@pythagoras/shared';
import { z } from 'zod';

// The messages the platform sends (ADR 0031): one template per kind, in plain
// text. A template names the recipient, says what happened and links to the
// portal, where access is checked as for any visit. Never health, dietary or
// assessment data, a document, or a link that works without signing in.

export interface Recipient {
  givenName: string;
  familyName: string;
}

export interface RenderedMessage {
  subject: string;
  text: string;
}

const id = z.uuid();

const TEMPLATES = {
  'order.paid': {
    params: z.strictObject({
      orderNumber: z.string().regex(/^PY-\d{8}$/),
      totalMinor: z.number().int().min(0),
      currency: z.string().regex(/^[A-Z]{3}$/),
      checkoutGroupId: id,
    }),
    render: (
      params: { orderNumber: string; totalMinor: number; currency: string; checkoutGroupId: string },
      to: Recipient,
      portal: string,
    ): RenderedMessage => ({
      subject: `Payment received: order ${params.orderNumber}`,
      text: [
        `Dear ${to.givenName} ${to.familyName},`,
        '',
        `We have received your payment of ${formatMoney(params.totalMinor, params.currency)} for order ${params.orderNumber}.`,
        'Your bookings are confirmed.',
        '',
        `See the order (sign in first): ${portal}/orders/${params.checkoutGroupId}`,
      ].join('\n'),
    }),
  },
} as const;

export type MessageKind = keyof typeof TEMPLATES;
export type MessageParams<K extends MessageKind> = z.infer<(typeof TEMPLATES)[K]['params']>;

export const isMessageKind = (kind: string): kind is MessageKind => Object.hasOwn(TEMPLATES, kind);

/** The parameters a message is queued with, checked against its template. */
export function messageParams<K extends MessageKind>(kind: K, params: unknown): MessageParams<K> {
  return TEMPLATES[kind].params.parse(params) as MessageParams<K>;
}

/** The message as sent; throws when the stored parameters no longer fit the template. */
export function renderMessage(
  kind: string,
  params: unknown,
  to: Recipient,
  portalUrl: string,
): RenderedMessage {
  if (!isMessageKind(kind)) throw new Error(`no template for ${kind}`);
  const template = TEMPLATES[kind];
  return template.render(template.params.parse(params), to, portalUrl.replace(/\/$/, ''));
}
