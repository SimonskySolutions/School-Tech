import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../lib/server';
import { entryBody, periodBody } from '../../../../../lib/timetable';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The timetable page's forms: lesson periods, and lessons in and out of the week. */
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
  // Back to the class being planned, so lessons can be added one after another.
  const classId = text(form, 'class_id');
  const outcome = (fields: Record<string, string>) =>
    go(
      `/schools/${id}/timetable?${new URLSearchParams({ ...(UUID.test(classId) ? { of: classId } : {}), ...fields })}`,
    );

  let call: { method: 'POST' | 'DELETE'; path: string; body?: unknown };
  try {
    if (action === 'add-period') {
      call = { method: 'POST', path: `/schools/${id}/timetable-periods`, body: periodBody(form) };
    } else if (action === 'add-lesson') {
      call = { method: 'POST', path: `/schools/${id}/timetable`, body: entryBody(form) };
    } else if (action === 'remove-lesson') {
      const entryId = text(form, 'entry_id');
      if (!UUID.test(entryId)) return outcome({ error: 'no such lesson' });
      call = { method: 'DELETE', path: `/schools/${id}/timetable/${entryId}` };
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
    done: action === 'add-period' ? 'period' : action === 'add-lesson' ? 'lesson' : 'removed',
  });
}
