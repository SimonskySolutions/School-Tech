import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { writeApi } from '../../../../../lib/api-client';
import { itemBody, movementBody, supplierBody } from '../../../../../lib/operations';
import { currentSession, runtime } from '../../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The inventory page's forms: items, stock changes and suppliers. */
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
    go(`/schools/${id}/inventory?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');

  let call: { method: 'POST' | 'PUT'; path: string; body: unknown; done: string };
  try {
    if (action === 'add-item') {
      call = { method: 'POST', path: `/schools/${id}/inventory/items`, body: itemBody(form), done: 'item' };
    } else if (action === 'move') {
      call = {
        method: 'POST',
        path: `/schools/${id}/inventory/movements`,
        body: movementBody(form),
        done: 'moved',
      };
    } else if (action === 'add-supplier') {
      call = { method: 'POST', path: `/schools/${id}/suppliers`, body: supplierBody(form), done: 'supplier' };
    } else {
      return outcome({ error: 'unknown action' });
    }
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }

  const result = await writeApi(
    config.API_INTERNAL_URL,
    session.accessToken,
    call.method,
    call.path,
    call.body,
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: call.done });
}
