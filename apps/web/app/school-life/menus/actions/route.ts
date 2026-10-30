import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../lib/admin';
import { writeApi } from '../../../../lib/api-client';
import { menuBody } from '../../../../lib/dietary';
import { readRange } from '../../../../lib/school-life';
import { currentSession, runtime } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Saves one lunch day's menu and returns to the menus page at that day. */
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
  const { from, days } = readRange({ from: text(form, 'from'), days: text(form, 'days') });
  const sessionId = text(form, 'session_id');
  const outcome = (fields: Record<string, string>) => {
    const query = new URLSearchParams(fields);
    if (from) query.set('from', from);
    if (days) query.set('days', String(days));
    return go(`/school-life/menus?${query}${UUID.test(sessionId) ? `#menu-${sessionId}` : ''}`);
  };
  if (!UUID.test(sessionId)) return outcome({ error: 'no such lunch day' });

  let body: unknown;
  try {
    body = menuBody(form);
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }
  const result = await writeApi(
    config.API_INTERNAL_URL,
    session.accessToken,
    'PUT',
    `/school-life/sessions/${sessionId}/menu`,
    body,
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: 'menu' });
}
