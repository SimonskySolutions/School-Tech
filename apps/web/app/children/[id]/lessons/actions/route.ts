import { type NextRequest, NextResponse } from 'next/server';
import { text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Books a lesson from a package, or cancels one; back to the lessons page with a notice. */
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
    go(`/children/${id}/lessons?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');

  let call: { path: string; body?: unknown };
  if (action === 'book') {
    const sessionId = text(form, 'session_id');
    const packageId = text(form, 'package_id');
    if (!UUID.test(sessionId) || !UUID.test(packageId)) return outcome({ error: 'no such time or package' });
    call = { path: `/students/${id}/lessons`, body: { sessionId, packageId } };
  } else if (action === 'cancel') {
    const bookingId = text(form, 'booking_id');
    if (!UUID.test(bookingId)) return outcome({ error: 'no such lesson' });
    call = { path: `/students/${id}/lessons/${bookingId}/cancel` };
  } else {
    return outcome({ error: 'unknown action' });
  }

  const result = await writeApi<{ outcome?: 'returned' | 'used' }>(
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
  return outcome({ done: action === 'book' ? 'booked' : `cancelled-${result.value.outcome ?? 'returned'}` });
}
