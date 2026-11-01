import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type MyTasks, type ProjectView, TASK_STATUSES } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import {
  closeProject,
  createProject,
  createTask,
  myTasks,
  projectView,
  refusalsAsTasks,
  setTaskStatus,
  TasksRejected,
  updateTask,
} from './tasks.repository';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
const title = z.string().trim().min(1).max(200);
const details = z.string().trim().min(1).max(4000);

export const taskSchema = z.strictObject({
  title,
  details: details.optional(),
  dueOn: day.optional(),
  assigneeId: z.uuid(),
  schoolId: z.uuid().optional(),
  projectId: z.uuid().optional(),
});
export const taskUpdateSchema = z.strictObject({
  title,
  details: details.optional(),
  dueOn: day.nullable().optional(),
  assigneeId: z.uuid(),
});
export const taskStatusSchema = z.strictObject({ status: z.enum(TASK_STATUSES) });
export const projectSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000).optional(),
  schoolId: z.uuid().optional(),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BadRequestException(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid request',
    );
  }
  return parsed.data;
}

async function run<T>(database: Database, principal: Principal, work: (tx: PersonTransaction) => Promise<T>) {
  try {
    return await refusalsAsTasks(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof TasksRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    if (error.status === 409) throw new ConflictException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

/** Tasks (M6.7): my own, those I set, and the overdue ones I see as a leader. */
@Controller('tasks')
export class TasksController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  mine(@CurrentPrincipal() principal: Principal): Promise<MyTasks> {
    return run(this.database, principal, (tx) => myTasks(tx));
  }

  @Post()
  @HttpCode(201)
  create(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const data = parse(taskSchema, body);
    return run(this.database, principal, (tx) => createTask(tx, data));
  }

  @Post(':taskId/status')
  @HttpCode(200)
  status(
    @CurrentPrincipal() principal: Principal,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() body: unknown,
  ) {
    const { status } = parse(taskStatusSchema, body);
    return run(this.database, principal, (tx) => setTaskStatus(tx, taskId, status));
  }

  @Post(':taskId/update')
  @HttpCode(200)
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('taskId', new ParseUUIDPipe()) taskId: string,
    @Body() body: unknown,
  ) {
    const data = parse(taskUpdateSchema, body);
    return run(this.database, principal, (tx) => updateTask(tx, taskId, data));
  }
}

/** Projects of a school or of the group, with their tasks. */
@Controller('projects')
export class ProjectsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Post()
  @HttpCode(201)
  create(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const data = parse(projectSchema, body);
    return run(this.database, principal, (tx) => createProject(tx, data));
  }

  @Get(':projectId')
  view(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<ProjectView> {
    return run(this.database, principal, async (tx) => {
      const found = await projectView(tx, projectId);
      if (!found) throw new TasksRejected(404, 'no such project, or not yours to see');
      return found;
    });
  }

  @Post(':projectId/close')
  @HttpCode(200)
  close(
    @CurrentPrincipal() principal: Principal,
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ) {
    return run(this.database, principal, (tx) => closeProject(tx, projectId));
  }
}
