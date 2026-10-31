import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../lib/admin';
import { type CreatedAccountResponse } from '@pythagoras/shared';
import { accountPage } from '../../../../lib/account-page';
import { closeBody, inviteBody, noteBody } from '../../../../lib/admissions';
import { writeApi } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Admissions staff log a contact on an inquiry or close it; back to the list with a notice. */
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

  const outcome = (fields: Record<string, string>) =>
    go(`/admissions/inquiries?${new URLSearchParams(fields)}`);
  const form = await request.formData();
  const action = text(form, 'action');
  const inquiryId = text(form, 'inquiry_id');
  if (!UUID.test(inquiryId)) return outcome({ error: 'no such inquiry' });

  if (action === 'invite') {
    let name;
    try {
      name = inviteBody(form);
    } catch (error) {
      if (error instanceof FormProblem) return outcome({ error: error.message });
      throw error;
    }
    const invited = await writeApi<CreatedAccountResponse>(
      config.API_INTERNAL_URL,
      session.accessToken,
      'POST',
      `/admissions/inquiries/${inquiryId}/invite`,
      name,
    );
    if (invited.kind === 'refused') {
      if (invited.status === 401) return go('/auth/sign-in');
      return outcome({ error: invited.message.slice(0, 300) });
    }
    // The answer itself, never a redirect: it may show a one-time password.
    return accountPage(invited.value, '/admissions/inquiries', 'Back to the inquiries');
  }

  let call: { path: string; body: unknown; done: string };
  try {
    if (action === 'note') {
      call = { path: `/admissions/inquiries/${inquiryId}/notes`, body: noteBody(form), done: 'noted' };
    } else if (action === 'close') {
      call = { path: `/admissions/inquiries/${inquiryId}/close`, body: closeBody(form), done: 'closed' };
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
