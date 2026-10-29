import { type NextRequest, NextResponse } from 'next/server';
import { postCancelBooking } from '../../../lib/api-client';
import { cancelNotice, readLunchQuery } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Cancels one lunch day from the lunch list and returns to it with a notice. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { config } = runtime();
  // Only the form on this site may cancel a booking.
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const session = await currentSession();
  const back = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  if (!session) return back('/auth/sign-in');

  const form = await request.formData();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : undefined;
  };
  const list = readLunchQuery({ schoolId: field('school_id'), date: field('date') });
  const bookingId = field('booking_id');
  if (!list || !bookingId || !UUID.test(bookingId)) return back('/school-life/kitchen');
  const listPath = `/school-life/lunch?${new URLSearchParams({ schoolId: list.schoolId, date: list.date })}`;

  const reason = (field('reason') ?? '').trim();
  if (reason.length < 3) return back(`${listPath}&notice=no-reason`);

  const result = await postCancelBooking(config.API_INTERNAL_URL, session.accessToken, bookingId, reason);
  if (result.kind === 'refused') {
    if (result.status === 401) return back('/auth/sign-in');
    return back(`${listPath}&notice=${cancelNotice(result.status)}`);
  }
  return back(`${listPath}&notice=cancelled`);
}
