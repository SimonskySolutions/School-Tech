import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../lib/server';
import { classBody, classChangeBody } from '../../../../../lib/timetable';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The classes pages' forms: add and change a class, place a child in it. */
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

  const form = await request.formData();
  const action = text(form, 'action');
  const classId = text(form, 'class_id');
  const page = UUID.test(classId) ? `/schools/${id}/classes/${classId}` : `/schools/${id}/classes`;
  const outcome = (fields: Record<string, string>) => go(`${page}?${new URLSearchParams(fields)}`);

  let call: { method: 'POST' | 'PATCH'; path: string; body: unknown };
  try {
    if (action === 'add-class') {
      call = { method: 'POST', path: `/schools/${id}/classes`, body: classBody(form) };
    } else if (action === 'change-class' && UUID.test(classId)) {
      call = { method: 'PATCH', path: `/schools/${id}/classes/${classId}`, body: classChangeBody(form) };
    } else if (action === 'place-student' && UUID.test(classId)) {
      call = {
        method: 'POST',
        path: `/schools/${id}/classes/${classId}/students`,
        body: { enrolmentId: text(form, 'enrolment_id') },
      };
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
  return outcome({
    done: action === 'add-class' ? 'class' : action === 'change-class' ? 'changed' : 'placed',
  });
}
