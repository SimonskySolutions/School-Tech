import { describe, expect, it } from 'vitest';
import { projectSchema, taskSchema, taskStatusSchema, taskUpdateSchema } from './tasks.controller';
import { refusalsAsTasks, TasksRejected } from './tasks.repository';

const ID = '0b1d2c3e-0000-7000-8000-000000000001';

describe('tasks', () => {
  it('name a title and an assignee, perhaps a due date, a school or a project', () => {
    expect(taskSchema.safeParse({ title: 'Book the stage', assigneeId: ID }).success).toBe(true);
    expect(
      taskSchema.safeParse({
        title: 'Book',
        assigneeId: ID,
        dueOn: '2026-12-01',
        projectId: ID,
        schoolId: ID,
      }).success,
    ).toBe(true);
    expect(taskSchema.safeParse({ title: ' ', assigneeId: ID }).success).toBe(false);
    expect(taskSchema.safeParse({ title: 'Book', assigneeId: ID, dueOn: 'tomorrow' }).success).toBe(false);
    expect(taskSchema.safeParse({ title: 'Book', assigneeId: ID, status: 'done' }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ title: 'Book', assigneeId: ID, dueOn: null }).success).toBe(true);
    expect(taskStatusSchema.safeParse({ status: 'in_progress' }).success).toBe(true);
    expect(taskStatusSchema.safeParse({ status: 'later' }).success).toBe(false);
    expect(projectSchema.safeParse({ name: 'Spring fair', ownerId: ID }).success).toBe(false);
  });

  it('pass on why the database refused', async () => {
    const open = Object.assign(new Error('tasks are still open in the project'), { code: 'PY001' });
    await expect(refusalsAsTasks(() => Promise.reject(open))).rejects.toEqual(
      new TasksRejected(409, 'tasks are still open in the project'),
    );
    const hidden = Object.assign(new Error('not someone you give tasks to here'), { code: 'P0002' });
    await expect(refusalsAsTasks(() => Promise.reject(hidden))).rejects.toEqual(
      new TasksRejected(404, 'no such task, project or colleague here'),
    );
  });
});
