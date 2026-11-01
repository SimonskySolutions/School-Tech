import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../../../lib/admin';
import { uploadDocumentFile, writeApi } from '../../../../../lib/api-client';
import { chosenFile, documentBody } from '../../../../../lib/documents';
import { currentSession, runtime } from '../../../../../lib/server';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Files a document with its first version, adds a version or archives one (M6.4). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { config } = runtime();
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const { id: schoolId } = await params;
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    return response;
  };
  const session = await currentSession();
  if (!session) return go('/auth/sign-in');
  if (!UUID.test(schoolId)) return go('/');
  const outcome = (fields: Record<string, string>) =>
    go(`/schools/${schoolId}/documents?${new URLSearchParams(fields)}`);
  const refused = (status: number, message: string) =>
    status === 401 ? go('/auth/sign-in') : outcome({ error: message.slice(0, 300) });

  const form = await request.formData();
  const action = text(form, 'action');
  const api = config.API_INTERNAL_URL;
  const upload = async (documentId: string, done: string) => {
    const { file, type } = chosenFile(form);
    const sent = await uploadDocumentFile(api, session.accessToken, documentId, {
      bytes: await file.arrayBuffer(),
      type,
      name: file.name,
    });
    return sent.kind === 'ok' ? outcome({ done }) : refused(sent.status, sent.message);
  };
  try {
    if (action === 'file') {
      const body = documentBody(form, schoolId);
      chosenFile(form);
      const created = await writeApi<{ id: string }>(api, session.accessToken, 'POST', '/documents', body);
      if (created.kind !== 'ok') return refused(created.status, created.message);
      return await upload(created.value.id, 'filed');
    }
    const documentId = text(form, 'document_id');
    if (!UUID.test(documentId)) throw new FormProblem('no such document');
    if (action === 'version') return await upload(documentId, 'versioned');
    if (action === 'archive') {
      const archived = await writeApi(api, session.accessToken, 'POST', `/documents/${documentId}/archive`);
      return archived.kind === 'ok'
        ? outcome({ done: 'archived' })
        : refused(archived.status, archived.message);
    }
    return outcome({ error: 'unknown action' });
  } catch (error) {
    if (error instanceof FormProblem) return outcome({ error: error.message });
    throw error;
  }
}
