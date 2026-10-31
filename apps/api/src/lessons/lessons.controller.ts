import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
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
import { type SchoolLessons, type StudentLessons } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import {
  addHours,
  addResource,
  bookLesson,
  cancelLesson,
  createSlots,
  LessonsRejected,
  refusalsAsLessons,
  removeHours,
  schoolLessons,
  studentLessons,
} from './lessons.repository';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'not a date');
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const bookSchema = z.object({ sessionId: z.uuid(), packageId: z.uuid() });
export const resourceSchema = z.object({
  kind: z.enum(['teacher', 'room']),
  displayName: z.string().trim().min(1).max(120),
});
export const hoursSchema = z
  .object({ weekday: z.number().int().min(1).max(7), starts: clock, ends: clock })
  .refine((hours) => hours.starts < hours.ends, { message: 'the end is before the start' });
export const slotsSchema = z
  .object({
    offeringId: z.uuid(),
    teacherId: z.uuid(),
    roomId: z.uuid(),
    from: day,
    to: day,
    minutes: z.number().int().min(15).max(240),
  })
  .refine((slots) => slots.from <= slots.to, { message: 'the last day is before the first' });
const rangeSchema = z.object({
  from: day.optional(),
  days: z.coerce.number().int().min(1).max(31).default(14),
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
    return await refusalsAsLessons(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof LessonsRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    if (error.status === 409) throw new ConflictException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

/** A family's lessons: packages, free slots, booked lessons (M4.3). */
@Controller('students/:studentId/lessons')
export class StudentLessonsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentLessons> {
    return run(this.database, principal, async (tx) => {
      const found = await studentLessons(tx, studentId);
      if (!found) throw new LessonsRejected(404, 'no such child, or not yours to see');
      return found;
    });
  }

  @Post()
  @HttpCode(201)
  book(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() body: unknown,
  ) {
    const data = parse(bookSchema, body);
    return run(this.database, principal, (tx) => bookLesson(tx, studentId, data.sessionId, data.packageId));
  }

  @Post(':bookingId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
  ) {
    return run(this.database, principal, (tx) => cancelLesson(tx, studentId, bookingId));
  }
}

/** Teachers, rooms, their hours and the lesson slots of one school (M4.3). */
@Controller('schools/:schoolId')
export class SchoolLessonsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('lessons')
  overview(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Query() query: unknown,
  ): Promise<SchoolLessons> {
    const range = parse(rangeSchema, query);
    return run(this.database, principal, async (tx) => {
      const from =
        range.from ??
        (
          await tx.query<{ today: string }>(
            `SELECT to_char((now() AT TIME ZONE time_zone)::date, 'YYYY-MM-DD') AS today FROM org.school WHERE id = $1`,
            [schoolId],
          )
        )[0]?.today;
      if (!from) throw new LessonsRejected(404, 'no such school');
      const found = await schoolLessons(tx, schoolId, { from, days: range.days });
      if (!found) throw new LessonsRejected(404, 'no such school, or not yours to see');
      return found;
    });
  }

  @Post('resources')
  @HttpCode(201)
  resource(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(resourceSchema, body);
    return run(this.database, principal, (tx) => addResource(tx, schoolId, data));
  }

  @Post('resources/:resourceId/hours')
  @HttpCode(201)
  hours(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('resourceId', new ParseUUIDPipe()) resourceId: string,
    @Body() body: unknown,
  ) {
    const data = parse(hoursSchema, body);
    return run(this.database, principal, (tx) => addHours(tx, schoolId, resourceId, data));
  }

  @Delete('resource-hours/:hoursId')
  @HttpCode(204)
  async removeHours(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('hoursId', new ParseUUIDPipe()) hoursId: string,
  ): Promise<void> {
    await run(this.database, principal, (tx) => removeHours(tx, schoolId, hoursId));
  }

  @Post('lesson-slots')
  @HttpCode(201)
  slots(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(slotsSchema, body);
    return run(this.database, principal, (tx) => createSlots(tx, schoolId, data));
  }
}
