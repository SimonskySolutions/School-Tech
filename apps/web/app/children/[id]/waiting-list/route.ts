import { type NextRequest, NextResponse } from 'next/server';
import { text } from '../../../../lib/admin';
import { writeApi } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Joins a full club's waiting list, or leaves one. */
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
    go(`/children/${id}/activities?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const offeringId = text(form, 'waiting_offering_id');
  const entryId = text(form, 'entry_id');
  if (!UUID.test(offeringId) && !UUID.test(entryId)) return outcome({ error: 'no such waiting list' });

  const result = UUID.test(offeringId)
    ? await writeApi(config.API_INTERNAL_URL, session.accessToken, 'POST', `/students/${id}/waiting-list`, {
        offeringId,
      })
    : await writeApi(
        config.API_INTERNAL_URL,
        session.accessToken,
        'DELETE',
        `/students/${id}/waiting-list/${entryId}`,
      );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: UUID.test(offeringId) ? 'joined' : 'left' });
}
