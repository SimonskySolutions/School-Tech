import { type CreatedAccountResponse } from '@pythagoras/shared';
import { NextResponse } from 'next/server';
import { standalonePage } from './standalone-page';

// The page that shows a new sign-in account's one-time temporary password
// (M3.2, and invitations to apply in M5.2, ADR 0027).

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The one-time password page. It is the direct answer to the form post, never
 * a redirect, so the password is in no address, history entry or log line.
 */
export function accountPage(
  account: CreatedAccountResponse,
  back: string,
  backLabel = 'Back to the school',
): NextResponse {
  const body = account.temporaryPassword
    ? `<p>Give this temporary password to the person in person or by phone. It is shown <strong>only now</strong>;
       they must choose their own password when they first sign in.</p>
       <p>User name: <code data-testid="new-username">${escape(account.username)}</code></p>
       <p>Temporary password: <code data-testid="temporary-password" class="secret">${escape(account.temporaryPassword)}</code></p>`
    : `<p>An e-mail with a link to set a password was sent to <code>${escape(account.username)}</code>.</p>`;
  const html = standalonePage(
    'Sign-in account created',
    `${body}<p style="margin-top:22px"><a class="button" href="${escape(back)}">${escape(backLabel)}</a></p>`,
  );
  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
