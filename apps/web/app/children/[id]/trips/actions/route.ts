import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../lib/server';
import { permissionBody } from '../../../../../lib/trips';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Gives or withdraws a trip permission; back to the trips page with a notice. */
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
    go(`/children/${id}/trips?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');

  let call: { path: string; body?: unknown };
  try {
    if (action === 'give') {
      const sessionId = text(form, 'session_id');
      if (!UUID.test(sessionId)) return outcome({ error: 'no such trip' });
      call = { path: `/students/${id}/trips/${sessionId}/permission`, body: permissionBody(form) };
    } else if (action === 'withdraw') {
      const permissionId = text(form, 'permission_id');
      if (!UUID.test(permissionId)) return outcome({ error: 'no such permission' });
      call = { path: `/students/${id}/trips/permissions/${permissionId}/withdraw` };
    } else {
      return outcome({ error: 'unknown action' });
    }
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }

  const result = await writeApi<{ outcome?: string }>(
    config.API_INTERNAL_URL,
    session.accessToken,
    'POST',
    call.path,
    call.body,
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: action === 'give' ? 'given' : (result.value.outcome ?? 'withdrawn') });
}
