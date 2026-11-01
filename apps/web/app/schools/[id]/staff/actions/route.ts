import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../lib/server';
import { employmentBody } from '../../../../../lib/staff';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The school's leaders record or end an employment; back to the staff page with a notice. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { config } = runtime();
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const { id: schoolId } = await params;
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  const session = await currentSession();
  if (!session) return go('/auth/sign-in');
  if (!UUID.test(schoolId)) return go('/');
  const outcome = (fields: Record<string, string>) =>
    go(`/schools/${schoolId}/staff?${new URLSearchParams(fields)}`);

  const form = await request.formData();
  const action = text(form, 'action');
  let call: { path: string; body: unknown; done: string };
  try {
    if (action === 'record') {
      call = { path: `/schools/${schoolId}/staff/employments`, body: employmentBody(form), done: 'recorded' };
    } else if (action === 'end') {
      const employmentId = text(form, 'employment_id');
      const endDate = text(form, 'end_date');
      if (!UUID.test(employmentId)) throw new FormProblem('no such employment');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new FormProblem('give the end date');
      call = { path: `/staff/employments/${employmentId}/end`, body: { endDate }, done: 'ended' };
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
