import { type CreatedAccountResponse } from '@pythagoras/shared';
import { type NextRequest, NextResponse } from 'next/server';
import { accountPage } from '../../../lib/account-page';
import {
  backTo,
  companyBody,
  eligibilityBody,
  type Form,
  FormProblem,
  offeringBody,
  schoolBody,
  sessionsBody,
  staffBody,
  text,
  tripConsentBody,
} from '../../../lib/admin';
import { postAdmin, writeApi } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Which API request each set-up form makes, and where a new school's page is. */
const ACTIONS: Record<
  string,
  (form: Form, id: string) => { path: string; body?: unknown; method?: 'POST' | 'PUT' }
> = {
  'create-company': (form) => ({ path: '/admin/billing-entities', body: companyBody(form) }),
  'create-school': (form) => ({ path: '/admin/schools', body: schoolBody(form) }),
  'add-offering': (form, id) => ({ path: `/admin/schools/${id}/offerings`, body: offeringBody(form) }),
  'set-eligibility': (form, id) => {
    const offeringId = text(form, 'offering_id');
    if (!UUID.test(offeringId)) throw new FormProblem('no such offering');
    return {
      method: 'PUT',
      path: `/admin/schools/${id}/offerings/${offeringId}/eligibility`,
      body: eligibilityBody(form),
    };
  },
  'set-trip-consent': (form, id) => {
    const offeringId = text(form, 'offering_id');
    if (!UUID.test(offeringId)) throw new FormProblem('no such offering');
    return {
      method: 'PUT',
      path: `/admin/schools/${id}/offerings/${offeringId}/trip-consent`,
      body: tripConsentBody(form),
    };
  },
  'add-sessions': (form, id) => ({ path: `/admin/schools/${id}/sessions`, body: sessionsBody(form) }),
  'add-staff': (form, id) => ({ path: `/admin/schools/${id}/staff`, body: staffBody(form) }),
  activate: (_form, id) => ({ path: `/admin/schools/${id}/activate` }),
  'create-website': (_form, id) => ({ path: `/admin/schools/${id}/website` }),
  'add-domain': (form, id) => ({
    path: `/admin/schools/${id}/website/domains`,
    body: { hostname: text(form, 'hostname') },
  }),
  'check-domain': (form, id) => {
    const domainId = text(form, 'domain_id');
    if (!UUID.test(domainId)) throw new FormProblem('no such domain');
    return { path: `/admin/schools/${id}/website/domains/${domainId}/check` };
  },
};

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
  let request_: { path: string; body?: unknown; method?: 'POST' | 'PUT' };
  try {
    request_ = build(form, schoolId);
  } catch (error) {
    if (error instanceof FormProblem) return go(backTo(back, { error: error.message }));
    throw error;
  }
  const result = await writeApi<{ id?: string }>(
    config.API_INTERNAL_URL,
    session.accessToken,
    request_.method ?? 'POST',
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
