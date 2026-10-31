import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { hoursBody, resourceBody, slotsBody } from '../../../../../lib/lessons';
import { currentSession, runtime } from '../../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The school lessons page's forms: teachers and rooms, their hours, lesson times. */
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

  const outcome = (fields: Record<string, string>) =>
    go(`/schools/${id}/lessons?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');

  let call: { method: 'POST' | 'DELETE'; path: string; body?: unknown };
  try {
    if (action === 'add-resource') {
      call = { method: 'POST', path: `/schools/${id}/resources`, body: resourceBody(form) };
    } else if (action === 'add-hours') {
      const resourceId = text(form, 'resource_id');
      if (!UUID.test(resourceId)) return outcome({ error: 'no such teacher or room' });
      call = { method: 'POST', path: `/schools/${id}/resources/${resourceId}/hours`, body: hoursBody(form) };
    } else if (action === 'remove-hours') {
      const hoursId = text(form, 'hours_id');
      if (!UUID.test(hoursId)) return outcome({ error: 'no such hours' });
      call = { method: 'DELETE', path: `/schools/${id}/resource-hours/${hoursId}` };
    } else if (action === 'create-slots') {
      call = { method: 'POST', path: `/schools/${id}/lesson-slots`, body: slotsBody(form) };
    } else {
      return outcome({ error: 'unknown action' });
    }
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }

  const result = await writeApi<{ created?: number }>(
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
  if (action === 'create-slots') return outcome({ created: String(result.value.created ?? 0) });
  return outcome({
    done: action === 'add-hours' ? 'hours' : action === 'remove-hours' ? 'hours-removed' : 'resource',
  });
}
