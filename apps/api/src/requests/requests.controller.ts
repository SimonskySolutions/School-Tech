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
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { REQUEST_KINDS, type SchoolRequests, type StudentRequests } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import {
  openRequest,
  refusalsAsRequests,
  reply,
  RequestsRejected,
  schoolRequests,
  setStatus,
  studentRequests,
} from './requests.repository';

const message = z.string().trim().min(1).max(4000);
export const openSchema = z.object({
  schoolId: z.uuid(),
  kind: z.enum(REQUEST_KINDS),
  subject: z.string().trim().min(1).max(200),
  message,
});
export const replySchema = z.object({ message });
export const statusSchema = z.object({ status: z.enum(['in_progress', 'closed']) });
const filterSchema = z.object({
  status: z.enum(['active', 'open', 'in_progress', 'answered', 'closed']).default('active'),
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
    return await refusalsAsRequests(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof RequestsRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    if (error.status === 409) throw new ConflictException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

/** A family's requests to the school about one child (M4.7). */
@Controller('students/:studentId/requests')
export class StudentRequestsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentRequests> {
    return run(this.database, principal, async (tx) => {
      const found = await studentRequests(tx, studentId);
      if (!found) throw new RequestsRejected(404, 'no such child, or not yours to see');
      return found;
    });
  }

  @Post()
  @HttpCode(201)
  open(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() body: unknown,
  ) {
    const data = parse(openSchema, body);
    return run(this.database, principal, (tx) => openRequest(tx, studentId, data));
  }

  @Post(':requestId/messages')
  @HttpCode(201)
  reply(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: unknown,
  ) {
    const data = parse(replySchema, body);
    return run(this.database, principal, (tx) => reply(tx, requestId, data.message, studentId));
  }

  @Post(':requestId/close')
  @HttpCode(200)
  close(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ) {
    return run(this.database, principal, (tx) => setStatus(tx, requestId, 'closed', studentId));
  }
}

/** Requests at the schools where the viewer handles them (M4.7). */
@Controller('school-life/requests')
export class SchoolRequestsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal, @Query() query: unknown): Promise<SchoolRequests> {
    const { status } = parse(filterSchema, query);
    return run(this.database, principal, async (tx) => {
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission_anywhere('requests.manage') AS ok`,
      );
      if (!allowed?.ok) throw new RequestsRejected(403, 'requests are for School Life and school leaders');
      return schoolRequests(tx, status);
    });
  }

  @Post(':requestId/messages')
  @HttpCode(201)
  reply(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: unknown,
  ) {
    const data = parse(replySchema, body);
    return run(this.database, principal, (tx) => reply(tx, requestId, data.message));
  }

  @Post(':requestId/status')
  @HttpCode(200)
  status(
    @CurrentPrincipal() principal: Principal,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Body() body: unknown,
  ) {
    const data = parse(statusSchema, body);
    return run(this.database, principal, (tx) => setStatus(tx, requestId, data.status));
  }
}
