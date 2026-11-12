import { type NextRequest, NextResponse } from 'next/server';
import { postCheckout } from '../../lib/api-client';
import { currentSession, runtime } from '../../lib/server';
import { basketFromForm, checkoutError } from '../../lib/services';

export const dynamic = 'force-dynamic';

const KEY = /^[A-Za-z0-9-]{16,100}$/;

/**
 * Places the orders from the booking form and sends the parent to the
 * provider's checkout. Several orders (several billing companies) go to the
 * order page, which offers one payment per company.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { config } = runtime();
  const back = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  };

  // Only the booking form on this site may place orders.
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const session = await currentSession();
  if (!session) return back('/auth/sign-in');

  const form = await request.formData();
  const key = form.get('idempotency_key');
  const items = basketFromForm(form.entries());
  if (typeof key !== 'string' || !KEY.test(key)) return back('/services?error=invalid');
  if (items.length === 0) return back('/services?error=empty');

  const result = await postCheckout(config.API_INTERNAL_URL, session.accessToken, key, { items });
  if (result.kind === 'refused') {
    if (result.status === 401) return back('/auth/sign-in');
    return back(`/services?error=${checkoutError(result.status)}`);
  }

  const { checkoutGroupId, orders } = result.value;
  const [only] = orders;
  if (orders.length === 1 && only?.checkoutUrl) {
    const response = NextResponse.redirect(only.checkoutUrl, 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  }
  return back(`/orders/${checkoutGroupId}`);
}
