import { type NextRequest, NextResponse } from 'next/server';
import { text } from '../../../lib/admin';
import { writeApi } from '../../../lib/api-client';
import { attendanceNotice, readRange } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Marks one child on a register attended or absent and returns to the registers. */
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
  const bookingId = text(form, 'booking_id');
  const status = text(form, 'status');
  const back = (notice: string) => {
    const query = new URLSearchParams({ notice });
    if (from) query.set('from', from);
    if (days) query.set('days', String(days));
    return go(`/school-life/registers?${query}`);
  };
  if (!UUID.test(bookingId) || (status !== 'attended' && status !== 'absent')) return back('failed');

  const result = await writeApi(
    config.API_INTERNAL_URL,
    session.accessToken,
    'POST',
    `/school-life/bookings/${bookingId}/attendance`,
    { status },
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return back(attendanceNotice(result.status));
  }
  return back('marked');
}
