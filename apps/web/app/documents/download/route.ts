import { type DownloadLink } from '@pythagoras/shared';
import { type NextRequest, NextResponse } from 'next/server';
import { text } from '../../../lib/admin';
import { writeApi } from '../../../lib/api-client';
import { backPath } from '../../../lib/documents';
import { currentSession, runtime } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Asks the API for a single-use link to a version, for the signed-in person,
 * and sends the browser to it (ADR 0029). The link lasts two minutes.
 */
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
  const back = backPath(text(form, 'back'));
  const failed = (message: string) => {
    const url = new URL(back, config.APP_URL);
    url.searchParams.set('error', message.slice(0, 300));
    return go(`${url.pathname}${url.search}`);
  };
  const versionId = text(form, 'version_id');
  if (!UUID.test(versionId)) return failed('no such document');
  const issued = await writeApi<DownloadLink>(
    config.API_INTERNAL_URL,
    session.accessToken,
    'POST',
    `/documents/versions/${versionId}/links`,
  );
  if (issued.kind !== 'ok') {
    return issued.status === 401 ? go('/auth/sign-in') : failed(issued.message);
  }
  return go(`/documents/files/${issued.value.token}`);
}
