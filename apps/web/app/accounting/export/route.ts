import { type NextRequest, NextResponse } from 'next/server';
import { fetchLedgerCsv } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The ledger CSV for group finance, passed on from the API as an attachment (M7.4). */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { config } = runtime();
  const session = await currentSession();
  if (!session) return NextResponse.redirect(new URL('/auth/sign-in', config.APP_URL), 303);
  const params = request.nextUrl.searchParams;
  const period = {
    companyId: params.get('companyId') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
  if (!UUID.test(period.companyId) || !DAY.test(period.from) || !DAY.test(period.to)) {
    return new NextResponse('Give the company and the period.', { status: 400 });
  }
  const answer = await fetchLedgerCsv(config.API_INTERNAL_URL, session.accessToken, period);
  if (!answer.ok) {
    const forbidden = answer.status === 403;
    return new NextResponse(forbidden ? 'This export is for group finance.' : 'The export failed.', {
      status: forbidden ? 403 : 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return new NextResponse(await answer.text(), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': answer.headers.get('content-disposition') ?? 'attachment; filename="ledger.csv"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
