import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../lib/admin';
import { applicationBody } from '../../../../lib/admissions';
import { writeApi } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A parent applies or withdraws an application; back to the page with a notice. */
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

  const outcome = (fields: Record<string, string>) => go(`/admissions/apply?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');

  let call: { path: string; body?: unknown; done: string };
  try {
    if (action === 'apply') {
      call = { path: '/admissions/applications', body: applicationBody(form), done: 'applied' };
    } else if (action === 'accept' || action === 'decline') {
      const applicationId = text(form, 'application_id');
      if (!UUID.test(applicationId)) return outcome({ error: 'no such application' });
      call = {
        path: `/admissions/applications/${applicationId}/answer`,
        body: { accept: action === 'accept' },
        done: action === 'accept' ? 'accepted' : 'declined',
      };
    } else if (action === 'withdraw') {
      const applicationId = text(form, 'application_id');
      if (!UUID.test(applicationId)) return outcome({ error: 'no such application' });
      call = { path: `/admissions/applications/${applicationId}/withdraw`, done: 'withdrawn' };
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
