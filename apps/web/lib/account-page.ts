import { type CreatedAccountResponse } from '@pythagoras/shared';
import { NextResponse } from 'next/server';

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
       <p>Temporary password: <code data-testid="temporary-password" style="font-size:1.25rem">${escape(account.temporaryPassword)}</code></p>`
    : `<p>An e-mail with a link to set a password was sent to <code>${escape(account.username)}</code>.</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign-in account created</title>
<meta name="robots" content="noindex"></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;line-height:1.5">
<p style="background:#fff4ce;padding:.5rem .75rem;border-radius:4px">Development build with synthetic data.</p>
<h1>Sign-in account created</h1>${body}
<p><a href="${escape(back)}">${escape(backLabel)}</a></p></body></html>`;
  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
