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
const name = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function template<S extends z.ZodType>(
  params: S,
  render: (params: z.infer<S>, to: Recipient, portal: string) => RenderedMessage,
) {
  return { params, render };
}

const greeting = (to: Recipient) => `Dear ${to.givenName} ${to.familyName},`;
const lines = (...parts: (string | null)[]) => parts.filter((part) => part !== null).join('\n');

const TEMPLATES = {
  'order.paid': template(
    z.strictObject({
      orderNumber: z.string().regex(/^PY-\d{8}$/),
      totalMinor: z.number().int().min(0),
      currency: z.string().regex(/^[A-Z]{3}$/),
      checkoutGroupId: id,
    }),
    (params, to, portal) => ({
      subject: `Payment received: order ${params.orderNumber}`,
      text: lines(
        greeting(to),
        '',
        `We have received your payment of ${formatMoney(params.totalMinor, params.currency)} for order ${params.orderNumber}.`,
        'Your bookings are confirmed.',
        '',
        `See the order (sign in first): ${portal}/orders/${params.checkoutGroupId}`,
      ),
    }),
  ),
  'approval.waiting': template(
    z.strictObject({
      title: name,
      schoolName: name.nullable(),
      versionNo: z.number().int().min(1),
      stepNo: z.number().int().min(1),
      steps: z.number().int().min(1),
    }),
    (params, to, portal) => ({
      subject: `Waiting for your approval: ${params.title}`,
      text: lines(
        greeting(to),
        '',
        `Version ${params.versionNo} of "${params.title}"${params.schoolName ? ` (${params.schoolName})` : ''} is waiting for your approval, step ${params.stepNo} of ${params.steps}.`,
        'Read it before you decide: an approved version never changes.',
        '',
        `Approvals (sign in first): ${portal}/documents/approvals`,
      ),
    }),
  ),
  'task.assigned': template(
    z.strictObject({
      title: name,
      dueOn: day.nullable(),
      projectName: name.nullable(),
      schoolName: name.nullable(),
      setBy: name,
    }),
    (params, to, portal) => ({
      subject: `A task for you: ${params.title}`,
      text: lines(
        greeting(to),
        '',
        `${params.setBy} has given you a task: "${params.title}"${params.projectName ? `, in the project "${params.projectName}"` : ''}${params.schoolName ? ` at ${params.schoolName}` : ''}.`,
        params.dueOn ? `It is due on ${params.dueOn}.` : null,
        '',
        `Your tasks (sign in first): ${portal}/tasks`,
      ),
    }),
  ),
  'request.answered': template(z.strictObject({ schoolName: name, studentId: id }), (params, to, portal) => ({
    subject: `${params.schoolName} has replied to your message`,
    text: lines(
      greeting(to),
      '',
      `${params.schoolName} has replied to your message. Read the reply in the family portal.`,
      '',
      `Messages to the school (sign in first): ${portal}/children/${params.studentId}/requests`,
    ),
  })),
  'consent.asked_again': template(
    z.strictObject({ purposeName: name, childGivenName: name, studentId: id }),
    (params, to, portal) => ({
      subject: `Your consent is asked again: ${params.purposeName}`,
      text: lines(
        greeting(to),
        '',
        `The school has changed what it asks for "${params.purposeName}". Your earlier consent for ${params.childGivenName} no longer counts until you read the new wording and agree to it, if you do.`,
        '',
        `Consents (sign in first): ${portal}/children/${params.studentId}/consents`,
      ),
    }),
  ),
  'admissions.invited': template(z.strictObject({ schoolName: name }), (params, to, portal) => ({
    subject: `${params.schoolName} invites you to apply`,
    text: lines(
      greeting(to),
      '',
      `Thank you for your interest in ${params.schoolName}. We invite you to apply for a place.`,
      'Set your password from the separate message about your account (or as the school told you), then sign in and apply.',
      '',
      `Apply (sign in first): ${portal}/admissions/apply`,
    ),
  })),
} as const;

export type MessageKind = keyof typeof TEMPLATES;
export type MessageParams<K extends MessageKind> = z.infer<(typeof TEMPLATES)[K]['params']>;

export const MESSAGE_KINDS = Object.keys(TEMPLATES) as MessageKind[];
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
  const chosen = TEMPLATES[kind] as {
    params: z.ZodType;
    render: (params: unknown, to: Recipient, portal: string) => RenderedMessage;
  };
  return chosen.render(chosen.params.parse(params), to, portalUrl.replace(/\/$/, ''));
}
