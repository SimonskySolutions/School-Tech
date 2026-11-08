import { type NextRequest, NextResponse } from 'next/server';
import { gradeBody, registerBody } from '../../../../../../../lib/academic';
import { FormProblem, text } from '../../../../../../../lib/admin';
import { writeApi } from '../../../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The register page's forms: the day's attendance and a new grade. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; classId: string }> },
): Promise<NextResponse> {
  const { config } = runtime();
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const { id, classId } = await params;
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  if (!UUID.test(id) || !UUID.test(classId)) return go('/');
  const session = await currentSession();
  if (!session) return go('/auth/sign-in');

  const form = await request.formData();
  const action = text(form, 'action');
  const base = `/schools/${id}/classes/${classId}`;
  const day = text(form, 'day');
  const outcome = (fields: Record<string, string>) =>
    go(`${base}/register?${new URLSearchParams({ ...(day ? { day } : {}), ...fields })}`);

  let call: { method: 'POST' | 'PUT'; path: string; body: unknown };
  try {
    if (action === 'save-register') {
      call = { method: 'PUT', path: `${base}/register`, body: registerBody(form) };
    } else if (action === 'add-grade') {
      call = { method: 'POST', path: `${base}/grades`, body: gradeBody(form) };
    } else {
      return outcome({ error: 'unknown action' });
    }
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }

  const result = await writeApi(
    config.API_INTERNAL_URL,
    session.accessToken,
    call.method,
    call.path,
    call.body,
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: action === 'save-register' ? 'saved' : 'grade' });
}
