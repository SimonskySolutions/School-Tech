import { type MyTasks, type ProjectView } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, post, tokenFor } from './helpers';

// Tasks and projects (M6.7) against the real stack. The seed has School A's
// spring fair (the kitchen's menu, the principal's overdue stage booking) and
// a task the principal of School B gave the teacher; the tests leave those as
// they are and add their own.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const PRINCIPAL_A = 'c1000000-0000-7000-8000-000000000006';
const TEACHER_B = 'c1000000-0000-7000-8000-000000000010';
const FAIR = 'e3000000-0000-7000-8000-000000000001';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const tokens: Record<string, string> = {};
const tasksOf = async (user: string) => (await get<MyTasks>('/tasks', tokens[user]!)).body;

beforeAll(async () => {
  for (const user of ['principal.a', 'principal.b', 'kitchen.a', 'teacher.b', 'ceo', 'anna.ivanova']) {
    tokens[user] = await tokenFor(user);
  }
});

describe('tasks and projects', () => {
  it('show each person their tasks, what they set and, to leaders, what is overdue', async () => {
    const kitchen = await tasksOf('kitchen.a');
    expect(kitchen.assigned.find((task) => task.title === 'Plan the fair menu (synthetic)')).toMatchObject({
      projectName: 'Spring fair (synthetic)',
      createdBy: { name: 'Petar Nikolov' },
      overdue: false,
      mayManage: false,
    });
    expect(kitchen.assigned.some((task) => task.title === 'Book the stage (synthetic)')).toBe(false);
    expect(kitchen.projects.find((project) => project.id === FAIR)).toMatchObject({ mayManage: false });
    expect(kitchen.assignable.flatMap((place) => place.people.map((person) => person.personId))).toEqual([
      KITCHEN_A,
      KITCHEN_A,
    ]);
    expect(kitchen.projectPlaces).toEqual([]);

    const principal = await tasksOf('principal.a');
    expect(principal.assigned.find((task) => task.title === 'Book the stage (synthetic)')!.overdue).toBe(
      true,
    );
    expect(principal.projects.find((project) => project.id === FAIR)!.overdueTasks).toBeGreaterThanOrEqual(1);
    expect(principal.projectPlaces).toEqual([{ schoolId: SCHOOL_A, schoolName: 'School A' }]);
    const atA = principal.assignable.find((place) => place.schoolId === SCHOOL_A)!;
    expect(atA.people.map((person) => person.personId)).toEqual(
      expect.arrayContaining([KITCHEN_A, PRINCIPAL_A]),
    );
    expect(atA.people.some((person) => person.personId === TEACHER_B)).toBe(false);

    expect((await tasksOf('principal.b')).setByMe.map((task) => task.title)).toContain(
      'Submit the term plan for mathematics (synthetic)',
    );
    expect((await tasksOf('teacher.b')).assigned.map((task) => task.title)).toContain(
      'Submit the term plan for mathematics (synthetic)',
    );
    expect((await tasksOf('ceo')).overdue.map((task) => task.title)).toContain('Book the stage (synthetic)');
    const parent = await tasksOf('anna.ivanova');
    expect([parent.assigned, parent.projects, parent.assignable.flatMap((place) => place.people)]).toEqual([
      [],
      [],
      [],
    ]);
  });

  it('let leaders run a project and give its tasks to those who work there', async () => {
    const project = await post<{ id: string }>(tokens['principal.a']!, '/projects', {
      name: 'Library move (integration test)',
      schoolId: SCHOOL_A,
    });
    expect(project.status).toBe(201);
    expect((await post(tokens['kitchen.a']!, '/projects', { name: 'x', schoolId: SCHOOL_A })).status).toBe(
      404,
    );
    const give = (user: string, assigneeId: string, extra: object = {}) =>
      post<{ id: string }>(tokens[user]!, '/tasks', {
        title: 'Pack the shelves (integration test)',
        assigneeId,
        schoolId: SCHOOL_A,
        projectId: project.body.id,
        dueOn: day(7),
        ...extra,
      });
    const task = await give('principal.a', KITCHEN_A);
    expect(task.status).toBe(201);
    expect((await give('principal.a', TEACHER_B)).status).toBe(404);
    expect((await give('principal.a', KITCHEN_A, { dueOn: day(-1) })).status).toBe(422);
    expect((await give('kitchen.a', KITCHEN_A)).status).toBe(404);

    const view = (await get<ProjectView>(`/projects/${project.body.id}`, tokens['kitchen.a']!)).body;
    expect(view.tasks.map((entry) => entry.title)).toEqual(['Pack the shelves (integration test)']);
    expect(view.assignable).toEqual([]);
    expect((await get(`/projects/${project.body.id}`, tokens['teacher.b']!)).status).toBe(404);
    expect(
      (await get<ProjectView>(`/projects/${project.body.id}`, tokens['principal.a']!)).body.assignable.map(
        (person) => person.personId,
      ),
    ).toContain(KITCHEN_A);

    expect((await post(tokens['principal.a']!, `/projects/${project.body.id}/close`)).status).toBe(409);
    const status = (user: string, value: string) =>
      post(tokens[user]!, `/tasks/${task.body.id}/status`, { status: value });
    expect((await status('teacher.b', 'done')).status).toBe(404);
    expect((await status('kitchen.a', 'cancelled')).status).toBe(404);
    expect((await status('kitchen.a', 'in_progress')).status).toBe(200);
    expect((await status('kitchen.a', 'in_progress')).status).toBe(409);
    expect((await status('kitchen.a', 'done')).status).toBe(200);
    expect((await post(tokens['principal.a']!, `/projects/${project.body.id}/close`)).status).toBe(200);
    expect((await give('principal.a', KITCHEN_A)).status).toBe(409);
  });

  it('let everyone keep their own list, and leaders change what they set', async () => {
    const own = await post<{ id: string }>(tokens['kitchen.a']!, '/tasks', {
      title: 'Order aprons (integration test)',
      assigneeId: KITCHEN_A,
      schoolId: SCHOOL_A,
    });
    expect(own.status).toBe(201);
    expect(
      (
        await post(tokens['kitchen.a']!, '/tasks', {
          title: 'x',
          assigneeId: PRINCIPAL_A,
          schoolId: SCHOOL_A,
        })
      ).status,
    ).toBe(404);
    expect(
      (await post(tokens['anna.ivanova']!, '/tasks', { title: 'x', assigneeId: KITCHEN_A })).status,
    ).toBe(404);

    const set = await post<{ id: string }>(tokens['principal.a']!, '/tasks', {
      title: 'Check the fire doors (integration test)',
      assigneeId: KITCHEN_A,
      schoolId: SCHOOL_A,
      dueOn: day(3),
    });
    const update = (user: string, body: object) => post(tokens[user]!, `/tasks/${set.body.id}/update`, body);
    expect((await update('kitchen.a', { title: 'x', assigneeId: KITCHEN_A })).status).toBe(404);
    expect(
      (await update('principal.a', { title: 'Check the fire doors', assigneeId: TEACHER_B })).status,
    ).toBe(404);
    expect(
      (
        await update('principal.a', {
          title: 'Check the fire doors and exits',
          assigneeId: PRINCIPAL_A,
          dueOn: null,
        })
      ).status,
    ).toBe(200);
    const moved = (await tasksOf('principal.a')).assigned.find((task) => task.id === set.body.id)!;
    expect(moved).toMatchObject({ title: 'Check the fire doors and exits', dueOn: null, mayManage: true });
    expect((await tasksOf('kitchen.a')).assigned.some((task) => task.id === set.body.id)).toBe(false);
  });
});
