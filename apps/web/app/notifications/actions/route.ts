import { type NextRequest, NextResponse } from 'next/server';
import { text } from '../../../lib/admin';
import { writeApi } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const KIND = /^[a-z]+(\.[a-z_]+)+$/;

/** Turns a kind of message on or off for the signed-in person; back with a notice. */
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
  const form = await request.formData();
  const kind = text(form, 'kind');
  const enabled = text(form, 'enabled') === 'true';
  if (!KIND.test(kind)) return go('/notifications?error=no+such+kind+of+message');
  const result = await writeApi(
    config.API_INTERNAL_URL,
    session.accessToken,
    'POST',
    '/notifications/preferences',
    {
      kind,
      enabled,
    },
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return go(`/notifications?${new URLSearchParams({ error: result.message.slice(0, 300) })}`);
  }
  return go(`/notifications?done=${enabled ? 'on' : 'off'}`);
}
