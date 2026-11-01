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
import { CONTRACT_KINDS, type Employment, type SchoolStaff } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import {
  endEmployment,
  myEmployments,
  recordEmployment,
  refusalsAsStaff,
  schoolStaff,
  StaffRejected,
} from './staff.repository';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');

// Only what ADR 0028 allows: no national number, address, salary or bank details.
export const employmentSchema = z
  .strictObject({
    personId: z.uuid(),
    employerId: z.uuid(),
    position: z.string().trim().min(1).max(100),
    contractKind: z.enum(CONTRACT_KINDS),
    workingTime: z.number().gt(0).max(1).multipleOf(0.01),
    startDate: day,
    endDate: day.optional(),
    workEmail: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
    workPhone: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9]{6,14}$/, 'a telephone number like +359888123456')
      .optional(),
  })
  .refine((body) => !body.endDate || body.endDate >= body.startDate, { message: 'it ends after it starts' })
  .refine((body) => body.contractKind !== 'fixed_term' || body.endDate !== undefined, {
    message: 'a fixed-term contract needs its end date',
  });
export const endSchema = z.object({ endDate: day });

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
    return await refusalsAsStaff(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof StaffRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    if (error.status === 409) throw new ConflictException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

/** Staff records of a school (M6.1, ADR 0028). */
@Controller('schools/:schoolId/staff')
export class SchoolStaffController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ): Promise<SchoolStaff> {
    return run(this.database, principal, async (tx) => {
      const found = await schoolStaff(tx, schoolId);
      if (!found) throw new StaffRejected(404, 'no such school, or not yours to see');
      return found;
    });
  }

  @Post('employments')
  @HttpCode(201)
  record(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(employmentSchema, body);
    return run(this.database, principal, (tx) => recordEmployment(tx, schoolId, data));
  }
}

@Controller('staff')
export class StaffController {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** The signed-in person's own employments. */
  @Get('me')
  mine(@CurrentPrincipal() principal: Principal): Promise<Employment[]> {
    return run(this.database, principal, (tx) => myEmployments(tx));
  }

  @Post('employments/:employmentId/end')
  @HttpCode(200)
  end(
    @CurrentPrincipal() principal: Principal,
    @Param('employmentId', new ParseUUIDPipe()) employmentId: string,
    @Body() body: unknown,
  ) {
    const { endDate } = parse(endSchema, body);
    return run(this.database, principal, (tx) => endEmployment(tx, employmentId, endDate));
  }
}
