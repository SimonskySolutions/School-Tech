import { type CreatedAccountResponse } from '@pythagoras/shared';
import { type NextRequest, NextResponse } from 'next/server';
import {
  backTo,
  companyBody,
  type Form,
  FormProblem,
  offeringBody,
  schoolBody,
  sessionsBody,
  staffBody,
  text,
} from '../../../lib/admin';
import { postAdmin } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Which API request each set-up form makes, and where a new school's page is. */
const ACTIONS: Record<string, (form: Form, id: string) => { path: string; body?: unknown }> = {
  'create-company': (form) => ({ path: '/admin/billing-entities', body: companyBody(form) }),
  'create-school': (form) => ({ path: '/admin/schools', body: schoolBody(form) }),
  'add-offering': (form, id) => ({ path: `/admin/schools/${id}/offerings`, body: offeringBody(form) }),
  'add-sessions': (form, id) => ({ path: `/admin/schools/${id}/sessions`, body: sessionsBody(form) }),
  'add-staff': (form, id) => ({ path: `/admin/schools/${id}/staff`, body: staffBody(form) }),
  activate: (_form, id) => ({ path: `/admin/schools/${id}/activate` }),
  'create-website': (_form, id) => ({ path: `/admin/schools/${id}/website` }),
};

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The one-time password page. It is the direct answer to the form post, never
 * a redirect, so the password is in no address, history entry or log line.
 */
function accountPage(account: CreatedAccountResponse, back: string): NextResponse {
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
<p><a href="${escape(back)}">Back to the school</a></p></body></html>`;
  return new NextResponse(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

/** Every set-up form posts here; the administrator returns to the page with a notice. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { config } = runtime();
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const session = await currentSession();
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  if (!session) return go('/auth/sign-in');

  const form = await request.formData();
  const action = text(form, 'action');
  const back = text(form, 'back');

  if (action === 'create-account') {
    const personId = text(form, 'person_id');
    if (!UUID.test(personId)) return go(backTo(back, { error: 'no such person' }));
    const result = await postAdmin<CreatedAccountResponse>(
      config.API_INTERNAL_URL,
      session.accessToken,
      `/admin/people/${personId}/account`,
    );
    if (result.kind === 'refused') return go(backTo(back, { error: result.message }));
    return accountPage(result.value, backTo(back, {}).replace(/\?$/, ''));
  }

  const build = ACTIONS[action];
  const schoolId = text(form, 'school_id');
  if (!build || (action !== 'create-company' && action !== 'create-school' && !UUID.test(schoolId))) {
    return go(backTo(back, { error: 'unknown action' }));
  }
  let request_: { path: string; body?: unknown };
  try {
    request_ = build(form, schoolId);
  } catch (error) {
    if (error instanceof FormProblem) return go(backTo(back, { error: error.message }));
    throw error;
  }
  const result = await postAdmin<{ id?: string }>(
    config.API_INTERNAL_URL,
    session.accessToken,
    request_.path,
    request_.body,
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return go(backTo(back, { error: result.message }));
  }
  // A new school opens on its own set-up page.
  const target = action === 'create-school' && result.value.id ? `/admin/schools/${result.value.id}` : back;
  return go(backTo(target, { done: action }));
}
