import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../lib/server';
import { stockBody, variantBody } from '../../../../../lib/uniforms';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The uniforms page's forms: hand over, change stock, add a variant. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { config } = runtime();
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const { id } = await params;
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  if (!UUID.test(id)) return go('/');
  const session = await currentSession();
  if (!session) return go('/auth/sign-in');

  const outcome = (fields: Record<string, string>) =>
    go(`/schools/${id}/uniforms?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');

  let call: { path: string; body?: unknown; done: string };
  try {
    if (action === 'hand-over') {
      const reservationId = text(form, 'reservation_id');
      if (!UUID.test(reservationId)) return outcome({ error: 'no such item' });
      call = { path: `/schools/${id}/uniform-handovers/${reservationId}`, done: 'handed-over' };
    } else if (action === 'stock') {
      const variantId = text(form, 'variant_id');
      if (!UUID.test(variantId)) return outcome({ error: 'no such size' });
      call = {
        path: `/schools/${id}/uniform-variants/${variantId}/stock`,
        body: stockBody(form),
        done: 'stock',
      };
    } else if (action === 'add-variant') {
      call = { path: `/schools/${id}/uniform-variants`, body: variantBody(form), done: 'variant' };
    } else {
      return outcome({ error: 'unknown action' });
    }
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }

  const result = await writeApi(config.API_INTERNAL_URL, session.accessToken, 'POST', call.path, call.body);
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: call.done });
}
