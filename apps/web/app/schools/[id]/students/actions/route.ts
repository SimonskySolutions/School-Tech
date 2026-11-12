import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { postAdmin } from '../../../../../lib/api-client';
import { enrolBody, guardianBody } from '../../../../../lib/families';
import { currentSession, runtime } from '../../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The students page's forms: enrol a student, record a guardian; back to the page with a notice. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { config } = runtime();
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const { id } = await params;
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  if (!UUID.test(id)) return go('/');
  const session = await currentSession();
  if (!session) return go('/auth/sign-in');

  const back = `/schools/${id}/students`;
  const outcome = (fields: Record<string, string>) => go(`${back}?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');

  let path: string;
  let body: unknown;
  try {
    if (action === 'enrol-student') {
      path = `/schools/${id}/students`;
      body = enrolBody(form);
    } else if (action === 'add-guardian') {
      const studentId = text(form, 'student_id');
      if (!UUID.test(studentId)) return outcome({ error: 'no such student' });
      path = `/schools/${id}/students/${studentId}/guardians`;
      body = guardianBody(form);
    } else {
      return outcome({ error: 'unknown action' });
    }
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }

  const result = await postAdmin(config.API_INTERNAL_URL, session.accessToken, path, body);
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: action });
}
