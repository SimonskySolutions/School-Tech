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
import { type ConsentPurposes, type SchoolConsents, type StudentConsents } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import {
  ConsentRejected,
  consentPurposes,
  giveConsent,
  publishWording,
  refusalsAsConsents,
  schoolConsents,
  studentConsents,
  withdrawConsent,
} from './consents.repository';

export const consentSchema = z.strictObject({ purposeId: z.uuid(), wordingId: z.uuid() });
export const wordingSchema = z.strictObject({
  wording: z.string().trim().min(20).max(4000),
  renewalRequired: z.boolean(),
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
    return await refusalsAsConsents(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof ConsentRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    if (error.status === 409) throw new ConflictException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

/** A child's consents, given and withdrawn by a guardian who may consent (M6.6, ADR 0030). */
@Controller('students/:studentId/consents')
export class StudentConsentsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentConsents> {
    return run(this.database, principal, async (tx) => {
      const found = await studentConsents(tx, studentId);
      if (!found) throw new ConsentRejected(404, 'no such child, or not yours to see');
      return found;
    });
  }

  @Post()
  @HttpCode(201)
  give(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() body: unknown,
  ) {
    const { purposeId, wordingId } = parse(consentSchema, body);
    return run(this.database, principal, (tx) => giveConsent(tx, studentId, purposeId, wordingId));
  }

  @Post(':purposeId/withdraw')
  @HttpCode(200)
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('purposeId', new ParseUUIDPipe()) purposeId: string,
  ) {
    return run(this.database, principal, (tx) => withdrawConsent(tx, studentId, purposeId));
  }
}

/** Who may appear in photos and recordings, for the school's staff. */
@Controller('schools/:schoolId/consents')
export class SchoolConsentsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ): Promise<SchoolConsents> {
    return run(this.database, principal, async (tx) => {
      const found = await schoolConsents(tx, schoolId);
      if (!found) throw new ConsentRejected(404, 'no such school, or not yours to see');
      return found;
    });
  }
}

/** The data protection officer's consent purposes and their wording. */
@Controller('privacy/consent-purposes')
export class ConsentPurposesController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal): Promise<ConsentPurposes> {
    return run(this.database, principal, async (tx) => {
      const found = await consentPurposes(tx);
      if (!found) throw new ConsentRejected(403, 'for the data protection officer');
      return found;
    });
  }

  @Post(':purposeId/wordings')
  @HttpCode(201)
  publish(
    @CurrentPrincipal() principal: Principal,
    @Param('purposeId', new ParseUUIDPipe()) purposeId: string,
    @Body() body: unknown,
  ) {
    const { wording, renewalRequired } = parse(wordingSchema, body);
    return run(this.database, principal, (tx) => publishWording(tx, purposeId, wording, renewalRequired));
  }
}
