import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { openBody, replyBody } from '../../../../../lib/requests';
import { currentSession, runtime } from '../../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A family opens a request, replies or closes it; back to the page with a notice. */
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
    go(`/children/${id}/requests?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');
  const requestId = text(form, 'request_id');

  let call: { path: string; body?: unknown; done: string };
  try {
    if (action === 'open') {
      call = { path: `/students/${id}/requests`, body: openBody(form), done: 'opened' };
    } else if (!UUID.test(requestId)) {
      return outcome({ error: 'no such request' });
    } else if (action === 'reply') {
      call = {
        path: `/students/${id}/requests/${requestId}/messages`,
        body: replyBody(form),
        done: 'replied',
      };
    } else if (action === 'close') {
      call = { path: `/students/${id}/requests/${requestId}/close`, done: 'closed' };
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
