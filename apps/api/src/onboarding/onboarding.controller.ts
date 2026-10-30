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
import { type OnboardingOverview } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { asHttpError } from '../common/database-errors';
import { Database, type PersonTransaction } from '../database/database';
import {
  activateSchool,
  createBillingEntity,
  createOffering,
  createSchool,
  createSessions,
  createStaff,
  OnboardingRejected,
  overview,
  schoolSetup,
} from './onboarding.repository';

const CODE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const text = (max: number) => z.string().trim().min(1).max(max);

const billingEntitySchema = z.object({
  legalName: text(200),
  // The company's registration number (in Bulgaria the EIK); the database requires it.
  registrationNumber: text(40),
  vatNumber: text(40).optional(),
});

const schoolSchema = z.object({
  code: z.string().regex(CODE, 'lower-case letters, digits and dashes, 2-63 characters'),
  name: text(200),
  kind: z.enum(['school', 'kindergarten', 'sports_academy', 'training_centre', 'college', 'other']),
  timeZone: text(64),
  billingEntityId: z.uuid(),
});

const offeringSchema = z.object({
  serviceDefinitionId: z.uuid(),
  name: text(200),
  unitAmountMinor: z.number().int().min(0).max(100_000_000),
  priceUnit: z.enum(['per_session', 'per_day', 'per_month', 'per_term', 'one_off']),
  vatRateBp: z.number().int().min(0).max(10_000).optional(),
});

const sessionsSchema = z.object({
  offeringId: z.uuid(),
  capacity: z.number().int().min(1).max(5000),
  location: text(100).optional(),
  schedule: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('school_days'),
      from: day,
      to: day,
      closed: z.array(day).max(400).optional(),
    }),
    z.object({
      type: z.literal('weekly'),
      weekday: z.number().int().min(1).max(7),
      startTime: time,
      endTime: time,
      from: day,
      to: day,
      closed: z.array(day).max(400).optional(),
    }),
  ]),
});

const staffSchema = z.object({
  givenName: text(100),
  familyName: text(100),
  email: z.email().max(254),
  roleCode: z.enum(['principal', 'school_admin', 'teacher', 'kitchen']),
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

/**
 * Adding a school (M3.1). For group administrators: org.manage to see this at
 * all, and the database checks catalog.manage, people.manage and
 * access.manage on each write.
 */
@Controller('admin')
export class OnboardingController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('onboarding')
  overview(@CurrentPrincipal() principal: Principal): Promise<OnboardingOverview> {
    return this.run(principal, (tx) => overview(tx));
  }

  @Get('schools/:schoolId')
  setup(@CurrentPrincipal() principal: Principal, @Param('schoolId', new ParseUUIDPipe()) schoolId: string) {
    return this.run(principal, (tx) => schoolSetup(tx, schoolId));
  }

  @Post('billing-entities')
  @HttpCode(201)
  billingEntity(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const data = parse(billingEntitySchema, body);
    return this.run(
      principal,
      (tx) => createBillingEntity(tx, data),
      'a company with this registration number already exists',
    );
  }

  @Post('schools')
  @HttpCode(201)
  school(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const data = parse(schoolSchema, body);
    return this.run(principal, (tx) => createSchool(tx, data), 'a school with this code already exists');
  }

  @Post('schools/:schoolId/offerings')
  @HttpCode(201)
  offering(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(offeringSchema, body);
    return this.run(
      principal,
      (tx) => createOffering(tx, schoolId, principal.personId, data),
      'this school already offers that service',
    );
  }

  @Post('schools/:schoolId/sessions')
  @HttpCode(201)
  sessions(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(sessionsSchema, body);
    return this.run(principal, (tx) => createSessions(tx, schoolId, data));
  }

  @Post('schools/:schoolId/staff')
  @HttpCode(201)
  staff(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(staffSchema, body);
    return this.run(principal, (tx) => createStaff(tx, schoolId, principal.personId, data));
  }

  @Post('schools/:schoolId/activate')
  @HttpCode(200)
  activate(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ) {
    return this.run(principal, (tx) => activateSchool(tx, schoolId));
  }

  private async run<T>(
    principal: Principal,
    work: (tx: PersonTransaction) => Promise<T>,
    duplicate?: string,
  ): Promise<T> {
    try {
      return await this.database.withPerson(principal, async (tx) => {
        const [allowed] = await tx.query<{ ok: boolean }>(
          `SELECT access.has_permission_anywhere('org.manage') AS ok`,
        );
        if (!allowed?.ok) throw new ForbiddenException('adding schools is for group administrators');
        return work(tx);
      });
    } catch (error) {
      if (error instanceof OnboardingRejected) {
        if (error.status === 404) throw new NotFoundException(error.message);
        if (error.status === 409) throw new ConflictException(error.message);
        throw new UnprocessableEntityException(error.message);
      }
      const code = (error as { code?: unknown } | null)?.code;
      if (code === '23505' && duplicate) throw new ConflictException(duplicate);
      if (code === 'PY005') throw new UnprocessableEntityException('unknown time zone');
      if (code === '23514' || code === '22P02')
        throw new UnprocessableEntityException('a value is not allowed here');
      throw asHttpError(error);
    }
  }
}
