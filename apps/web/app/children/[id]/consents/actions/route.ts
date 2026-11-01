import { type NextRequest, NextResponse } from 'next/server';
import { text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Gives or withdraws a consent; back to the child's consents with a notice. */
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
    go(`/children/${id}/consents?${new URLSearchParams(fields)}`);

  const form = await request.formData();
  const action = text(form, 'action');
  const purposeId = text(form, 'purpose_id');
  if (!UUID.test(purposeId)) return outcome({ error: 'no such purpose' });
  let call: { path: string; body?: unknown; done: string };
  if (action === 'give') {
    const wordingId = text(form, 'wording_id');
    if (!UUID.test(wordingId)) return outcome({ error: 'no such wording' });
    if (text(form, 'agree') !== 'yes') return outcome({ error: 'tick the box to say you agree' });
    call = { path: `/students/${id}/consents`, body: { purposeId, wordingId }, done: 'given' };
  } else if (action === 'withdraw') {
    call = { path: `/students/${id}/consents/${purposeId}/withdraw`, done: 'withdrawn' };
  } else {
    return outcome({ error: 'unknown action' });
  }
  const result = await writeApi(config.API_INTERNAL_URL, session.accessToken, 'POST', call.path, call.body);
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: call.done });
}
