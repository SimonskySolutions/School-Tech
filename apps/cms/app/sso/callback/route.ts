import config from '@payload-config';
import { type NextRequest, NextResponse } from 'next/server';
import { getPayload } from 'payload';
import { editorFromClaims, NotAnEditor } from '../../../sso/editor';
import { completeSignIn, signInEditor, ssoSettings, TRANSACTION_COOKIE } from '../../../sso/flow';

export const dynamic = 'force-dynamic';

const page = (status: number, title: string, body: string, headers: Record<string, string> = {}) =>
  new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${headers.refresh ?? ''}</head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;line-height:1.5"><h1>${title}</h1>${body}</body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

/** Keycloak returns here: check everything, then give the editor a Payload session (ADR 0019). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const settings = ssoSettings();
  const payload = await getPayload({ config });
  const current = new URL(request.nextUrl.pathname + request.nextUrl.search, settings.publicUrl);

  let response: NextResponse;
  try {
    const claims = await completeSignIn(
      settings,
      payload.secret,
      current,
      request.cookies.get(TRANSACTION_COOKIE)?.value,
    );
    const editor = editorFromClaims(claims);
    const { token, exp, cookieName } = await signInEditor(payload, editor);
    // A page that moves on by itself: the editor's strict session cookie is
    // then sent on the first admin page, which a redirect from Keycloak would not do.
    response = page(
      200,
      'Signed in',
      '<p data-testid="signed-in">Opening the website editor… <a href="/admin">Continue</a></p>',
      { refresh: '<meta http-equiv="refresh" content="0;url=/admin">' },
    );
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: settings.secure,
      path: '/',
      expires: new Date(exp * 1000),
    });
  } catch (error) {
    const refused = error instanceof NotAnEditor;
    payload.logger.warn(`editor sign-in refused: ${error instanceof Error ? error.message : 'unknown'}`);
    response = page(
      refused ? 403 : 400,
      refused ? 'No access to the website editor' : 'Sign-in did not complete',
      refused
        ? '<p data-testid="not-an-editor">Your Pythagoras account may not edit the websites. Ask a website administrator for access.</p>'
        : '<p data-testid="sign-in-failed">Please <a href="/sso/login">try again</a>.</p>',
    );
  }
  response.cookies.set(TRANSACTION_COOKIE, '', { path: '/sso', maxAge: 0 });
  return response;
}
