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
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type ClassDetail,
  type SchoolClasses,
  type SchoolTimetable,
  type StudentTimetable,
} from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import {
  academicYearOf,
  addClass,
  addEntry,
  addPeriod,
  changeClass,
  classDetail,
  placeStudent,
  refusalsAsTimetable,
  removeEntry,
  schoolClasses,
  schoolTimetable,
  studentTimetable,
  TimetableRejected,
} from './timetable.repository';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const year = z.string().regex(/^\d{4}\/\d{4}$/);
const optionalId = z.uuid().nullable();

export const classSchema = z.object({
  label: z.string().trim().min(1).max(40),
  gradeLevel: z.string().trim().min(1).max(40),
  capacity: z.number().int().min(1).max(60),
  formTeacherId: optionalId,
  homeRoomId: optionalId,
});
export const classChangeSchema = z.object({
  capacity: z.number().int().min(1).max(60),
  formTeacherId: optionalId,
  homeRoomId: optionalId,
});
export const placeSchema = z.object({ enrolmentId: z.uuid() });
export const periodSchema = z
  .object({ position: z.number().int().min(1).max(12), starts: clock, ends: clock })
  .refine((period) => period.starts < period.ends, { message: 'the end is before the start' });
export const entrySchema = z.object({
  classId: z.uuid(),
  weekday: z.number().int().min(1).max(5),
  periodId: z.uuid(),
  subject: z.string().trim().min(1).max(80),
  teacherId: z.uuid(),
  roomId: z.uuid(),
});
const yearQuery = z.object({ year: year.optional() });
const timetableQuery = z.object({
  year: year.optional(),
  view: z.enum(['class', 'teacher', 'room']).default('class'),
  of: z.uuid().optional(),
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
    return await refusalsAsTimetable(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof TimetableRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    if (error.status === 409) throw new ConflictException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

const thisYear = () => academicYearOf(new Date());

/** A school's classes and weekly timetable. */
@Controller('schools/:schoolId')
export class SchoolTimetableController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('classes')
  classes(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Query() query: unknown,
  ): Promise<SchoolClasses> {
    const academicYear = parse(yearQuery, query).year ?? thisYear();
    return run(this.database, principal, (tx) => schoolClasses(tx, schoolId, academicYear));
  }

  @Post('classes')
  @HttpCode(201)
  addClass(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(classSchema, body);
    return run(this.database, principal, (tx) => addClass(tx, schoolId, thisYear(), data));
  }

  @Get('classes/:classId')
  classDetail(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('classId', new ParseUUIDPipe()) classId: string,
  ): Promise<ClassDetail> {
    return run(this.database, principal, (tx) => classDetail(tx, schoolId, classId));
  }

  @Patch('classes/:classId')
  @HttpCode(204)
  async changeClass(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('classId', new ParseUUIDPipe()) classId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const data = parse(classChangeSchema, body);
    await run(this.database, principal, (tx) => changeClass(tx, schoolId, classId, data));
  }

  @Post('classes/:classId/students')
  @HttpCode(204)
  async place(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('classId', new ParseUUIDPipe()) classId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const data = parse(placeSchema, body);
    await run(this.database, principal, (tx) => placeStudent(tx, schoolId, classId, data.enrolmentId));
  }

  @Get('timetable')
  timetable(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Query() query: unknown,
  ): Promise<SchoolTimetable> {
    const { year: chosen, view, of } = parse(timetableQuery, query);
    return run(this.database, principal, (tx) =>
      schoolTimetable(tx, schoolId, chosen ?? thisYear(), view, of),
    );
  }

  @Post('timetable-periods')
  @HttpCode(201)
  addPeriod(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(periodSchema, body);
    return run(this.database, principal, (tx) => addPeriod(tx, schoolId, data));
  }

  @Post('timetable')
  @HttpCode(201)
  addEntry(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(entrySchema, body);
    return run(this.database, principal, (tx) => addEntry(tx, schoolId, thisYear(), data));
  }

  @Delete('timetable/:entryId')
  @HttpCode(204)
  async removeEntry(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<void> {
    await run(this.database, principal, (tx) => removeEntry(tx, schoolId, entryId));
  }
}

/** A child's week, for the family. */
@Controller('students/:studentId/timetable')
export class StudentTimetableController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  timetable(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentTimetable> {
    return run(this.database, principal, async (tx) => {
      const found = await studentTimetable(tx, studentId, thisYear());
      if (!found) throw new TimetableRejected(404, 'no such child, or not yours to see');
      return found;
    });
  }
}
