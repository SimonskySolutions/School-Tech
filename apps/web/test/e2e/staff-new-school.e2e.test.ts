import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// M6.8: the staff path end to end at a school added through administration,
// with no code, migration or configuration change. The group administrator
// sets up School F with its company, principal and a new teacher. Its
// principal records the teacher's employment, a teaching licence that ends
// within 60 days and a record check; files a policy for all staff and has it
// approved by the principal, then the CEO; files the teacher's contract; and
// gives the teacher a task in a project, which the teacher finishes. The
// teacher downloads the approved policy and their contract, and sees no
// colleague's records; School A's principal sees none of School F's. Test data
// uses the "test-" prefix and is removed before each run.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const ADMIN_PASSWORD = readFileSync('/workspace/secrets/keycloak_admin_password', 'utf8').trim();
const KEYCLOAK = 'http://keycloak:8080';
const LUNCH = 'd1000000-0000-7000-8000-000000000001';
const run = Date.now().toString(36);
const code = `test-${run}-f`;
const schoolName = `School F ${run}`;
const companyName = `Test company ${run} F`;
const POLICY = `%PDF-1.7\n% Safeguarding policy, School F (synthetic, ${run})\n%%EOF\n`;

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const page = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(new URL(path, APP).toString())).response.text());
const post = (browser: Browser, path: string, fields: Record<string, string> | [string, string][]) =>
  browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
const upload = (browser: Browser, path: string, fields: [string, string | File][]) => {
  const body = new FormData();
  for (const [name, value] of fields) body.append(name, value);
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { origin: APP },
    body,
    redirect: 'manual',
  });
};
const params = (response: Response) => new URL(response.headers.get('location')!).searchParams;
/** The notice a form came back with, failing with the error if there was one. */
const done = (response: Response) => {
  const back = params(response);
  expect(back.get('error')).toBeNull();
  return back.get('done');
};
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const plus = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
const after = (html: string, marker: string) => html.slice(html.indexOf(marker));
/** One person's entry on a school's staff page. */
const entry = (html: string, personId: string) => {
  const start = html.indexOf(`data-testid="staff-${personId}"`);
  return html.slice(start, html.indexOf('</article>', start));
};

function nextMonday(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7));
  return date;
}

/** Stands in for a new person choosing their own password at first sign-in. */
async function firstSignIn(username: string): Promise<Browser> {
  const admin = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: ADMIN_PASSWORD,
    }),
  });
  const { access_token } = (await admin.json()) as { access_token: string };
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${KEYCLOAK}/admin/realms/pythagoras${path}`, {
      ...init,
      headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    });
  const [user] = (await (
    await call(`/users?username=${encodeURIComponent(username)}&exact=true`)
  ).json()) as {
    id: string;
  }[];
  const password = `Chosen-${run}-Passw0rd`;
  await call(`/users/${user!.id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [] }) });
  await call(`/users/${user!.id}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: password, temporary: false }),
  });
  return (await signIn(username, password)).browser;
}

describe('the staff path at a school added through administration', () => {
  it('takes a new teacher from a role to an employment, an approved policy and a finished task', async () => {
    // 1. The group administrator sets School F up, with a principal and a new teacher.
    const admin = (await signIn('admin@pythagoras.test', PASSWORD)).browser;
    const added = await post(admin, '/admin/actions', {
      action: 'create-company',
      back: '/admin/schools',
      legal_name: companyName,
      registration_number: String(Date.now()).slice(-9),
    });
    const overview = await page(admin, added.headers.get('location')!);
    const companyId = new RegExp(`<option value="([0-9a-f-]{36})">${companyName}</option>`).exec(
      overview,
    )![1]!;
    const created = await post(admin, '/admin/actions', {
      action: 'create-school',
      back: '/admin/schools',
      name: schoolName,
      code,
      kind: 'school',
      time_zone: 'Europe/Sofia',
      billing_entity_id: companyId,
    });
    const schoolId = /\/admin\/schools\/([0-9a-f-]{36})/.exec(created.headers.get('location')!)![1]!;
    const back = `/admin/schools/${schoolId}`;
    await post(admin, '/admin/actions', {
      action: 'add-offering',
      back,
      school_id: schoolId,
      service_definition_id: LUNCH,
      name: `Lunch at ${schoolName}`,
      price: '5.40',
      price_unit: 'per_day',
    });
    const offeringId = /<select name="offering_id" required=""><option value="([0-9a-f-]{36})"/.exec(
      await page(admin, back),
    )![1]!;
    const monday = nextMonday();
    await post(admin, '/admin/actions', {
      action: 'add-sessions',
      back,
      school_id: schoolId,
      offering_id: offeringId,
      pattern: 'school_days',
      from: plus(monday, 0),
      to: plus(monday, 4),
      capacity: '60',
      closed: '',
    });
    const addStaff = async (givenName: string, role: string) => {
      const email = `test-${run}-f-${role}@pythagoras.test`;
      await post(admin, '/admin/actions', {
        action: 'add-staff',
        back,
        school_id: schoolId,
        given_name: givenName,
        family_name: 'Fstaff',
        email,
        role_code: role,
      });
      const personId = /data-testid="create-account-([0-9a-f-]{36})"/.exec(await page(admin, back))![1]!;
      expect(
        (await post(admin, '/admin/actions', { action: 'create-account', back, person_id: personId })).status,
      ).toBe(200);
      return { email, personId };
    };
    const head = await addStaff('Fiona', 'principal');
    const newTeacher = await addStaff('Filip', 'teacher');
    await post(admin, '/admin/actions', { action: 'create-website', back, school_id: schoolId });
    const activated = await post(admin, '/admin/actions', { action: 'activate', back, school_id: schoolId });
    expect(await page(admin, activated.headers.get('location')!)).toContain('Status: active.');

    // 2. School F's principal records the teacher's employment, licence and record check.
    const principal = await firstSignIn(head.email);
    const staffPage = `/schools/${schoolId}/staff`;
    expect(await page(principal, '/')).toContain(`href="${staffPage}"`);
    expect(entry(await page(principal, staffPage), newTeacher.personId)).toContain(
      'Has a role here but no current employment',
    );
    const staffAct = (fields: [string, string][]) => post(principal, `${staffPage}/actions`, fields);
    expect(
      done(
        await staffAct([
          ['action', 'record'],
          ['person_id', newTeacher.personId],
          ['employer_id', companyId],
          ['position', 'Teacher of physics'],
          ['contract_kind', 'permanent'],
          ['working_time', '100'],
          ['start_date', day(0)],
        ]),
      ),
    ).toBe('recorded');
    expect(
      done(
        await staffAct([
          ['action', 'qualify'],
          ['person_id', newTeacher.personId],
          ['kind', 'teaching_licence'],
          ['title', 'Teacher of physics (synthetic)'],
          ['awarded_on', day(-700)],
          ['expires_on', day(30)],
        ]),
      ),
    ).toBe('qualified');
    expect(
      done(
        await staffAct([
          ['action', 'check'],
          ['person_id', newTeacher.personId],
          ['seen_on', day(0)],
          ['valid_until', day(180)],
        ]),
      ),
    ).toBe('checked');
    const records = await page(principal, staffPage);
    expect(records).toContain(`Teacher of physics, permanent, full time, with ${companyName}`);
    expect(after(records, 'data-testid="needs-attention"')).toContain(
      'Filip Fstaff: a qualification ends within 60 days',
    );
    expect(entry(records, newTeacher.personId)).not.toContain('Has a role here but no current employment');

    // 3. A policy for all staff, approved by the principal and then the CEO; the teacher's contract.
    const documents = `/schools/${schoolId}/documents`;
    expect(
      done(
        await upload(principal, `${documents}/actions`, [
          ['action', 'file'],
          ['title', 'Safeguarding policy (e2e, School F)'],
          ['category', 'policy'],
          ['attached', 'school'],
          ['for_all_staff', 'yes'],
          ['file', new File([POLICY], 'safeguarding.pdf', { type: 'application/pdf' })],
        ]),
      ),
    ).toBe('filed');
    expect(
      done(
        await upload(principal, `${documents}/actions`, [
          ['action', 'file'],
          ['title', 'Contract (e2e, School F)'],
          ['category', 'contract'],
          ['attached', `staff:${newTeacher.personId}`],
          [
            'file',
            new File(['%PDF-1.7\n% contract (synthetic)\n'], 'contract.pdf', { type: 'application/pdf' }),
          ],
        ]),
      ),
    ).toBe('filed');
    const filed = after(
      await page(principal, documents),
      '<strong>Safeguarding policy (e2e, School F)</strong>',
    );
    const versionId = /name="version_id" value="([0-9a-f-]{36})"/.exec(filed)![1]!;
    expect(
      done(
        await post(principal, '/documents/approvals/actions', [
          ['action', 'ask'],
          ['version_id', versionId],
          ['back', documents],
          ['step_1', 'principal'],
          ['step_2', 'group_ceo'],
        ]),
      ),
    ).toBe('asked');
    const approve = async (browser: Browser) => {
      const waiting = await page(browser, '/documents/approvals');
      const at = waiting.indexOf('<strong>Safeguarding policy (e2e, School F)</strong>');
      const stepId = /data-testid="waiting-([0-9a-f-]{36})"/.exec(
        waiting.slice(waiting.lastIndexOf('<li', at)),
      )![1]!;
      return done(
        await post(browser, '/documents/approvals/actions', [
          ['action', 'decide'],
          ['step_id', stepId],
          ['back', '/documents/approvals'],
          ['decision', 'approved'],
        ]),
      );
    };
    expect(await approve(principal)).toBe('pending');
    const ceo = (await signIn('ceo@pythagoras.test', PASSWORD)).browser;
    expect(await approve(ceo)).toBe('approved');

    // 4. A project at School F, and a task in it for the teacher.
    const started = await post(principal, '/tasks/actions', [
      ['action', 'project'],
      ['name', 'Science week (e2e, School F)'],
      ['school_id', schoolId],
    ]);
    expect(done(started)).toBe('project');
    const projectPath = new URL(started.headers.get('location')!).pathname;
    expect(
      done(
        await post(principal, '/tasks/actions', [
          ['action', 'task'],
          ['project_id', projectPath.split('/')[2]!],
          ['back', projectPath],
          ['title', 'Prepare the experiments (e2e, School F)'],
          ['due_on', day(7)],
          ['assignee', `${schoolId}:${newTeacher.personId}`],
        ]),
      ),
    ).toBe('task');

    // 5. The teacher signs in: the approved policy, their contract and the task.
    const teacher = await firstSignIn(newTeacher.email);
    const seen = after(
      await page(teacher, documents),
      '<strong>Safeguarding policy (e2e, School F)</strong>',
    );
    expect(seen).toContain('Approval: approved: the principal (approved by Fiona Fstaff');
    expect(seen).toContain('then the CEO (approved by Elena Petrova');
    const asked = await post(teacher, '/documents/download', [
      ['version_id', versionId],
      ['back', documents],
    ]);
    const file = await teacher.request(new URL(asked.headers.get('location')!, APP).toString());
    expect(file.status).toBe(200);
    expect(await file.text()).toBe(POLICY);
    const mine = await page(teacher, '/staff/me');
    expect(mine).toContain(`Teacher of physics at ${schoolName}, permanent, full time, with ${companyName}`);
    expect(mine).toContain('Contract: Contract (e2e, School F)');
    const list = after(await page(teacher, '/tasks'), 'data-testid="my-tasks"');
    const at = list.indexOf('<strong>Prepare the experiments (e2e, School F)</strong>');
    expect(at).toBeGreaterThan(-1);
    const taskId = /data-testid="task-([0-9a-f-]{36})"/.exec(list.slice(list.lastIndexOf('<li', at)))![1]!;
    expect(
      done(
        await post(teacher, '/tasks/actions', [
          ['action', 'status'],
          ['task_id', taskId],
          ['status', 'done'],
          ['back', '/tasks'],
        ]),
      ),
    ).toBe('status');
    expect(await page(principal, projectPath)).toContain('1 done');

    // 6. Staff records stay with the school's leaders and the group's.
    expect(await page(teacher, staffPage)).toContain('data-testid="not-permitted"');
    const elsewhere = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await page(elsewhere, staffPage)).toContain('data-testid="not-permitted"');
    expect(await page(elsewhere, projectPath)).toContain('data-testid="not-permitted"');
    expect(entry(await page(ceo, staffPage), newTeacher.personId)).toContain('Teacher of physics');
  });
});
