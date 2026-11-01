import { type NextRequest, NextResponse } from 'next/server';
import { fetchDocumentFile } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// Headers passed on from the API's answer; nothing else about it reaches the browser.
const PASSED = ['content-type', 'content-length', 'content-disposition'] as const;

/**
 * A download link (ADR 0029): redeemed once, by the signed-in person it was
 * issued to; the API writes the download to the access log and streams the
 * file, always as an attachment.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { config } = runtime();
  const session = await currentSession();
  if (!session) return NextResponse.redirect(new URL('/auth/sign-in', config.APP_URL), 303);
  const { token } = await params;
  const gone = () =>
    new NextResponse('This download link has expired or been used. Go back and ask for the file again.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  if (!TOKEN.test(token)) return gone();
  const answer = await fetchDocumentFile(config.API_INTERNAL_URL, session.accessToken, token);
  if (!answer.ok || !answer.body) return gone();
  const headers = new Headers({
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'referrer-policy': 'no-referrer',
  });
  for (const name of PASSED) {
    const value = answer.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.get('content-disposition')?.startsWith('attachment')) return gone();
  return new NextResponse(answer.body, { status: 200, headers });
}
