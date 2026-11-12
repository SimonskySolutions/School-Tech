import { type NextRequest, NextResponse } from 'next/server';
import { FormProblem, text } from '../../../lib/admin';
import { writeApi } from '../../../lib/api-client';
import { backPath } from '../../../lib/documents';
import { currentSession, runtime } from '../../../lib/server';
import { projectBody, taskBody, taskStatus, taskUpdateBody } from '../../../lib/tasks';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Adds, moves or changes a task, or starts or closes a project (M6.7); back with a notice. */
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
  const back = new URL(backPath(text(form, 'back') || '/tasks'), config.APP_URL);
  const outcome = (name: 'done' | 'error', value: string, path?: string) => {
    const target = path ? new URL(path, config.APP_URL) : back;
    target.searchParams.delete('done');
    target.searchParams.delete('error');
    target.searchParams.set(name, value.slice(0, 300));
    return go(`${target.pathname}${target.search}`);
  };
  const id = (name: string) => {
    const value = text(form, name);
    if (!UUID.test(value)) throw new FormProblem('no such task or project');
    return value;
  };

  let call: { path: string; body?: unknown; done: string; toProject?: boolean };
  try {
    const action = text(form, 'action');
    if (action === 'task') call = { path: '/tasks', body: taskBody(form), done: 'task' };
    else if (action === 'status')
      call = { path: `/tasks/${id('task_id')}/status`, body: { status: taskStatus(form) }, done: 'status' };
    else if (action === 'update')
      call = { path: `/tasks/${id('task_id')}/update`, body: taskUpdateBody(form), done: 'updated' };
    else if (action === 'project')
      call = { path: '/projects', body: projectBody(form), done: 'project', toProject: true };
    else if (action === 'close') call = { path: `/projects/${id('project_id')}/close`, done: 'closed' };
    else return outcome('error', 'unknown action');
  } catch (error) {
    if (error instanceof FormProblem) return outcome('error', error.message);
    throw error;
  }
  const result = await writeApi<{ id?: string }>(
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
  if (call.toProject && result.value.id) return outcome('done', call.done, `/projects/${result.value.id}`);
  return outcome('done', call.done);
}
