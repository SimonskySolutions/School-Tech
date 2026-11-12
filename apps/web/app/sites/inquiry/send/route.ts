import { type NextRequest, NextResponse } from 'next/server';
import { inquiryBody, isTrapped, sentNotice } from '../../../../lib/admissions';
import { FormProblem } from '../../../../lib/admin';
import { sendInquiry } from '../../../../lib/cms';
import { runtime } from '../../../../lib/server';
import { SITE_HOST_HEADER } from '../../../../lib/sites';

export const dynamic = 'force-dynamic';

/**
 * A website's inquiry form (M5.1): only from a page of the same website,
 * then back to the form with a notice that never says whether the address
 * was known (ADR 0026). Nothing about the sender is logged or kept here.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const host = request.headers.get(SITE_HOST_HEADER);
  const origin = request.headers.get('origin');
  let site: URL;
  try {
    site = new URL(origin ?? '');
  } catch {
    return new NextResponse('Forbidden', { status: 403 });
  }
  if (!host || site.hostname !== host) return new NextResponse('Forbidden', { status: 403 });

  const back = (fields: Record<string, string>) => {
    const response = NextResponse.redirect(
      new URL(`/inquiry?${new URLSearchParams(fields)}`, site.origin),
      303,
    );
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  const form = await request.formData();
  if (isTrapped(form)) return back({ result: 'sent' });
  let body;
  try {
    body = inquiryBody(form, host);
  } catch (error) {
    if (error instanceof FormProblem) return back({ problem: error.message });
    throw error;
  }
  const { config } = runtime();
  const status = await sendInquiry(config.API_INTERNAL_URL, body);
  if (status === 400 || status === 422) return back({ problem: 'a value is not accepted' });
  return back({ result: sentNotice(status) });
}
