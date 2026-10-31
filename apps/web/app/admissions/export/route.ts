import { type NextRequest, NextResponse } from 'next/server';
import { text } from '../../../lib/admin';
import { writeApi } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * What is held about a prospective family, as a file for their access
 * request (Art. 15, M5.6). A form post, never a link: each export is
 * recorded as a request and written to the access log.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { config } = runtime();
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const session = await currentSession();
  if (!session) return NextResponse.redirect(new URL('/auth/sign-in', config.APP_URL), 303);
  const form = await request.formData();
  const kind = text(form, 'kind');
  const id = text(form, 'id');
  if ((kind !== 'inquiry' && kind !== 'application') || !UUID.test(id)) {
    return new NextResponse('Not found', { status: 404 });
  }
  const path =
    kind === 'inquiry' ? `/admissions/inquiries/${id}/export` : `/admissions/applications/${id}/export`;
  const result = await writeApi<unknown>(config.API_INTERNAL_URL, session.accessToken, 'POST', path, {});
  if (result.kind === 'refused') {
    return new NextResponse(result.message, { status: result.status === 401 ? 401 : 404 });
  }
  return new NextResponse(JSON.stringify(result.value, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="admissions-${kind}-${id}.json"`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
