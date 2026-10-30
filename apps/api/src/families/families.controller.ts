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
import { type AddGuardianResponse, type StudentList } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { asHttpError } from '../common/database-errors';
import { Database, type PersonTransaction } from '../database/database';
import { addGuardian, enrolStudent, FamiliesRejected, listStudents } from './families.repository';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'not a date');
const name = z.string().trim().min(1).max(100);
const label = z.string().trim().min(1).max(40);

const enrolSchema = z.object({
  givenName: name,
  familyName: name,
  dateOfBirth: day.optional(),
  academicYear: z.string().regex(/^\d{4}\/\d{4}$/, 'like 2026/2027'),
  gradeLevel: label.optional(),
  classLabel: label.optional(),
  startDate: day,
});

const guardianSchema = z.object({
  email: z.email().max(254),
  givenName: name.optional(),
  familyName: name.optional(),
  relationship: z.enum(['mother', 'father', 'parent', 'legal_guardian', 'foster_carer', 'other']),
  canPay: z.boolean().optional(),
  canManageBookings: z.boolean().optional(),
  canConsent: z.boolean().optional(),
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

/** Students and their guardians at one school (M3.3), for the school's staff. */
@Controller('schools/:schoolId/students')
export class FamiliesController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ): Promise<StudentList> {
    return this.run(principal, (tx) => listStudents(tx, schoolId));
  }

  @Post()
  @HttpCode(201)
  enrol(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(enrolSchema, body);
    return this.run(principal, (tx) => enrolStudent(tx, schoolId, data));
  }

  @Post(':studentId/guardians')
  @HttpCode(201)
  guardian(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() body: unknown,
  ): Promise<AddGuardianResponse> {
    const data = parse(guardianSchema, body);
    return this.run(principal, (tx) => addGuardian(tx, schoolId, studentId, data));
  }

  private async run<T>(principal: Principal, work: (tx: PersonTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.database.withPerson(principal, work);
    } catch (error) {
      if (error instanceof FamiliesRejected) {
        if (error.status === 404) throw new NotFoundException(error.message);
        if (error.status === 403) throw new ForbiddenException(error.message);
        throw new UnprocessableEntityException(error.message);
      }
      const code = (error as { code?: unknown } | null)?.code;
      if (code === '23505') throw new ConflictException('this guardian is already recorded for the child');
      if (code === '23514') throw new UnprocessableEntityException('a value is not allowed here');
      throw asHttpError(error);
    }
  }
}
