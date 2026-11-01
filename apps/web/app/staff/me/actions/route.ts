import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../lib/admin';
import { fetchMe, writeApi } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';
import { trainingBody } from '../../../../lib/staff';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A member of staff records their own training or updates it (M6.3). */
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
  const outcome = (fields: Record<string, string>) => go(`/staff/me?${new URLSearchParams(fields)}`);

  const form = await request.formData();
  const action = text(form, 'action');
  let call: { path: string; body: unknown; done: string };
  try {
    if (action === 'train') {
      const me = await fetchMe(config.API_INTERNAL_URL, session.accessToken);
      if (me.kind !== 'ok') return go('/auth/sign-in');
      call = {
        path: `/staff/people/${me.value.person.id}/training`,
        body: trainingBody(form),
        done: 'trained',
      };
    } else if (action === 'training-attended' || action === 'training-cancelled') {
      const trainingId = text(form, 'training_id');
      if (!UUID.test(trainingId)) throw new FormProblem('no such training');
      const status = action === 'training-attended' ? 'attended' : 'cancelled';
      call = { path: `/staff/training/${trainingId}/status`, body: { status }, done: status };
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
