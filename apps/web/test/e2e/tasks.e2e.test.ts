import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Tasks and projects through the web app (M6.7): the principal of School A
// sees the overdue stage booking, starts a project and gives the kitchen a
// task in it; the kitchen starts and finishes it from "Tasks"; the principal
// closes the project; a teacher at School B cannot see it.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const TITLE = 'Hang the bunting (e2e test)';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const send = (browser: Browser, fields: [string, string][]) =>
  browser.request(`${APP}/tasks/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
const location = (response: Response) => new URL(response.headers.get('location')!);
const notice = (response: Response, name: string) => location(response).searchParams.get(name);
const section = (page: string, testId: string) => {
  const start = page.indexOf(`data-testid="${testId}"`);
  return page.slice(start, page.indexOf('</section>', start));
};
const taskId = (page: string, title: string) => {
  const at = page.indexOf(`<strong>${title}</strong>`);
  return /data-testid="task-([0-9a-f-]{36})"/.exec(page.slice(page.lastIndexOf('<li', at), at))![1]!;
};

describe('tasks and projects', () => {
  it('run from a project to a finished task', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await open(principal, '/')).toContain('href="/tasks"');
    const mine = section(await open(principal, '/tasks'), 'my-tasks');
    expect(mine).toContain('Book the stage (synthetic)');
    expect(mine).toContain('OVERDUE');

    const started = await send(principal, [
      ['action', 'project'],
      ['name', 'Sports day (e2e test)'],
      ['school_id', SCHOOL_A],
    ]);
    expect(notice(started, 'done')).toBe('project');
    const projectPath = location(started).pathname;
    expect(projectPath).toMatch(/^\/projects\/[0-9a-f-]{36}$/);
    const projectId = projectPath.split('/')[2]!;
    expect(
      notice(
        await send(principal, [
          ['action', 'task'],
          ['project_id', projectId],
          ['back', projectPath],
          ['title', ''],
          ['assignee', `${SCHOOL_A}:${KITCHEN_A}`],
        ]),
        'error',
      ),
    ).toBe('give the task a title');
    expect(
      notice(
        await send(principal, [
          ['action', 'task'],
          ['project_id', projectId],
          ['back', projectPath],
          ['title', TITLE],
          ['assignee', `${SCHOOL_A}:${KITCHEN_A}`],
        ]),
        'done',
      ),
    ).toBe('task');
    expect(await open(principal, projectPath)).toContain('1 to do');

    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const list = section(await open(kitchen, '/tasks'), 'my-tasks');
    expect(list).toContain(
      `${TITLE}</strong> · To do · for Radka Mineva · set by Petar Nikolov · project: Sports day (e2e test)`,
    );
    const id = taskId(list, TITLE);
    const move = (status: string) =>
      send(kitchen, [
        ['action', 'status'],
        ['task_id', id],
        ['status', status],
        ['back', '/tasks'],
      ]);
    expect(notice(await move('in_progress'), 'done')).toBe('status');
    expect(notice(await move('cancelled'), 'error')).toBeTruthy();
    expect(notice(await move('done'), 'done')).toBe('status');

    const summary = await open(principal, projectPath);
    expect(summary).toContain('0 to do');
    expect(summary).toContain('1 done');
    expect(
      notice(
        await send(principal, [
          ['action', 'close'],
          ['project_id', projectId],
          ['back', projectPath],
        ]),
        'done',
      ),
    ).toBe('closed');

    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    expect(await open(teacher, projectPath)).toContain('data-testid="not-permitted"');
    expect(section(await open(teacher, '/tasks'), 'my-tasks')).toContain(
      'Submit the term plan for mathematics (synthetic)',
    );
  });
});
