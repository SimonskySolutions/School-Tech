import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../lib/admin';
import { writeApi } from '../../../../lib/api-client';
import { wordingBody } from '../../../../lib/consents';
import { currentSession, runtime } from '../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Publishes the next wording of a consent purpose; back to the wording page with a notice. */
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
  const outcome = (fields: Record<string, string>) => go(`/privacy/consents?${new URLSearchParams(fields)}`);

  const form = await request.formData();
  const purposeId = text(form, 'purpose_id');
  if (!UUID.test(purposeId)) return outcome({ error: 'no such purpose' });
  let body;
  try {
    body = wordingBody(form);
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }
  const result = await writeApi(
    config.API_INTERNAL_URL,
    session.accessToken,
    'POST',
    `/privacy/consent-purposes/${purposeId}/wordings`,
    body,
  );
  if (result.kind === 'refused') {
    if (result.status === 401) return go('/auth/sign-in');
    return outcome({ error: result.message.slice(0, 300) });
  }
  return outcome({ done: 'published' });
}
