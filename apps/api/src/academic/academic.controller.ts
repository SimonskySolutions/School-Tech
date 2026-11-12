import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type ClassRegister, type StudentProgress } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import { academicYearOf } from '../timetable/timetable.repository';
import {
  AcademicRejected,
  addGrade,
  classRegister,
  refusalsAsAcademic,
  saveRegister,
  studentProgress,
} from './academic.repository';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'not a date');

export const registerSchema = z.object({
  day,
  marks: z
    .array(z.object({ studentId: z.uuid(), status: z.enum(['present', 'late', 'absent', 'excused']) }))
    .min(1)
    .max(60),
});
export const gradeSchema = z.object({
  studentId: z.uuid(),
  subject: z.string().trim().min(1).max(80),
  term: z.number().int().min(1).max(2),
  value: z.number().int().min(2).max(6),
});
const dayQuery = z.object({ day: day.optional() });

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
    return await refusalsAsAcademic(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof AcademicRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

/** The class register and grades, for those who teach. */
@Controller('schools/:schoolId/classes/:classId')
export class ClassRegisterController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('register')
  register(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('classId', new ParseUUIDPipe()) classId: string,
    @Query() query: unknown,
  ): Promise<ClassRegister> {
    const chosen = parse(dayQuery, query).day ?? new Date().toISOString().slice(0, 10);
    return run(this.database, principal, (tx) => classRegister(tx, schoolId, classId, chosen));
  }

  @Put('register')
  @HttpCode(204)
  async save(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('classId', new ParseUUIDPipe()) classId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const data = parse(registerSchema, body);
    await run(this.database, principal, (tx) => saveRegister(tx, schoolId, classId, data));
  }

  @Post('grades')
  @HttpCode(201)
  grade(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('classId', new ParseUUIDPipe()) classId: string,
    @Body() body: unknown,
  ) {
    const data = parse(gradeSchema, body);
    return run(this.database, principal, (tx) => addGrade(tx, schoolId, classId, data));
  }
}

/** A child's register and grades, for the family. */
@Controller('students/:studentId/progress')
export class StudentProgressController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  progress(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentProgress> {
    return run(this.database, principal, async (tx) => {
      const found = await studentProgress(tx, studentId, academicYearOf(new Date()));
      if (!found) throw new AcademicRejected(404, 'no such child, or not yours to see');
      return found;
    });
  }
}
