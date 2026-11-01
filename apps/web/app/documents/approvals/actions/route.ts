import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../lib/admin';
import { writeApi } from '../../../../lib/api-client';
import { approvalSteps, backPath, decisionBody } from '../../../../lib/documents';
import { currentSession, runtime } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Asks for, withdraws or decides an approval (M6.5); back to the page it came from with a notice. */
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
  const back = new URL(backPath(text(form, 'back')), config.APP_URL);
  const outcome = (name: 'done' | 'error', value: string) => {
    back.searchParams.delete('done');
    back.searchParams.delete('error');
    back.searchParams.set(name, value.slice(0, 300));
    return go(`${back.pathname}${back.search}`);
  };
  const id = (name: string) => {
    const value = text(form, name);
    if (!UUID.test(value)) throw new FormProblem('no such approval');
    return value;
  };

  let call: { path: string; body?: unknown; done?: string };
  try {
    const action = text(form, 'action');
    if (action === 'ask') {
      call = {
        path: `/documents/versions/${id('version_id')}/approvals`,
        body: { steps: approvalSteps(form) },
        done: 'asked',
      };
    } else if (action === 'withdraw') {
      call = { path: `/documents/approvals/${id('request_id')}/withdraw`, done: 'withdrawn' };
    } else if (action === 'decide') {
      call = { path: `/documents/approval-steps/${id('step_id')}/decision`, body: decisionBody(form) };
    } else {
      return outcome('error', 'unknown action');
    }
  } catch (error) {
    if (error instanceof FormProblem) return outcome('error', error.message);
    throw error;
  }
  const result = await writeApi<{ outcome?: string }>(
    config.API_INTERNAL_URL,
    session.accessToken,
    'POST',
    call.path,
    call.body,
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome('error', result.message);
  }
  return outcome('done', call.done ?? result.value.outcome ?? 'pending');
}
