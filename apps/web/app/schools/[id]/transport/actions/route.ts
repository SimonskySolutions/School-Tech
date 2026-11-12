import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../lib/server';
import { routeBody, stopBody } from '../../../../../lib/transport';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Sets up a route or adds a stop; back to the school's transport page with a notice. */
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
    go(`/schools/${id}/transport?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');
  const offeringId = text(form, 'offering_id');
  if (!UUID.test(offeringId)) return outcome({ error: 'no such route' });

  let call: { path: string; body: unknown };
  try {
    if (action === 'add-route') {
      call = { path: `/schools/${id}/transport-routes`, body: routeBody(form) };
    } else if (action === 'add-stop') {
      call = { path: `/schools/${id}/transport-routes/${offeringId}/stops`, body: stopBody(form) };
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
  return outcome({ done: action === 'add-route' ? 'route' : 'stop' });
}
