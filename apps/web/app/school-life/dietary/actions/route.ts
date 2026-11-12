import { type NextRequest, NextResponse } from 'next/server';
import { text } from '../../../../lib/admin';
import { writeApi } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** School Life verifies one need and returns to the review with a notice. */
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
  const needId = text(form, 'need_id');
  const outcome = (fields: Record<string, string>) =>
    go(`/school-life/dietary?${new URLSearchParams(fields)}`);
  if (!UUID.test(needId)) return outcome({ error: 'no such need' });

  const result = await writeApi(
    config.API_INTERNAL_URL,
    session.accessToken,
    'POST',
    `/school-life/dietary/${needId}/verify`,
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: 'verified' });
}
