import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../lib/admin';
import { applicationNoteBody, enrolBody, intakeBody, offerBody } from '../../../../lib/admissions';
import { writeApi } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Admissions staff open or close an intake, or take an application into review. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { config } = runtime();
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  const session = await currentSession();
  if (!session) return go('/auth/sign-in');

  const outcome = (fields: Record<string, string>) =>
    go(`/admissions/applications?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');
  const id = (name: string) => {
    const value = text(form, name);
    if (!UUID.test(value)) throw new FormProblem('no such record');
    return value;
  };

  let call: { path: string; body?: unknown; done: string };
  try {
    if (action === 'open-intake') {
      call = { path: '/admissions/intakes', body: intakeBody(form), done: 'intake-opened' };
    } else if (action === 'set-fee') {
      const offeringId = text(form, 'offering_id');
      if (offeringId && !UUID.test(offeringId)) throw new FormProblem('choose the fee');
      call = {
        path: `/admissions/intakes/${id('intake_id')}/fee`,
        body: { offeringId: offeringId || null },
        done: 'fee-set',
      };
    } else if (action === 'close-intake') {
      call = { path: `/admissions/intakes/${id('intake_id')}/close`, done: 'intake-closed' };
    } else if (action === 'offer') {
      call = {
        path: `/admissions/applications/${id('application_id')}/offer`,
        body: offerBody(form),
        done: 'offered',
      };
    } else if (action === 'waitlist' || action === 'reject') {
      const decision = action === 'waitlist' ? 'waitlisted' : 'rejected';
      call = {
        path: `/admissions/applications/${id('application_id')}/decision`,
        body: { decision },
        done: decision,
      };
    } else if (action === 'erase') {
      if (text(form, 'confirm') !== 'yes') throw new FormProblem('confirm that the family asked for erasure');
      call = { path: `/admissions/applications/${id('application_id')}/erase`, done: 'erased' };
    } else if (action === 'enrol') {
      call = {
        path: `/admissions/applications/${id('application_id')}/enrol`,
        body: enrolBody(form, text(form, 'new_child') === 'yes'),
        done: 'enrolled',
      };
    } else if (action === 'note') {
      call = {
        path: `/admissions/applications/${id('application_id')}/notes`,
        body: applicationNoteBody(form),
        done: 'noted',
      };
    } else if (action === 'review') {
      call = { path: `/admissions/applications/${id('application_id')}/review`, done: 'reviewed' };
    } else {
      return outcome({ error: 'unknown action' });
    }
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }

  const result = await writeApi(config.API_INTERNAL_URL, session.accessToken, 'POST', call.path, call.body);
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: call.done });
}
