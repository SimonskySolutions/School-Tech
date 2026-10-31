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
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type StudentTrips, type TripParticipants } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import { defaultFrom } from '../school-life/school-life.repository';
import {
  givePermission,
  recordPermission,
  refusalsAsTrips,
  setTripConsent,
  studentTrips,
  tripParticipants,
  TripsRejected,
  withdrawPermission,
} from './trips.repository';

const contact = {
  emergencyContactName: z.string().trim().min(1).max(120),
  emergencyContactPhone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,25}$/, 'a phone number such as +359 88 123 4567'),
};
export const permissionSchema = z.object({
  policyVersionId: z.uuid(),
  // The guardian ticks that they have read and agree to this wording.
  agree: z.literal(true),
  ...contact,
});
export const recordSchema = z.object({
  studentId: z.uuid(),
  guardianPersonId: z.uuid(),
  channel: z.enum(['paper', 'in_person']),
  policyVersionId: z.uuid(),
  ...contact,
});
export const wordingSchema = z.object({ text: z.string().trim().min(10).max(5000) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeSchema = z.object({
  from: day.optional(),
  days: z.coerce.number().int().min(1).max(92).default(31),
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
    return await refusalsAsTrips(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof TripsRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    if (error.status === 409) throw new ConflictException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

/** A family's trips: the wording, the permission and the place (M4.4). */
@Controller('students/:studentId/trips')
export class StudentTripsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentTrips> {
    return run(this.database, principal, async (tx) => {
      const found = await studentTrips(tx, studentId);
      if (!found) throw new TripsRejected(404, 'no such child, or not yours to see');
      return found;
    });
  }

  @Post(':sessionId/permission')
  @HttpCode(201)
  give(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: unknown,
  ) {
    const data = parse(permissionSchema, body);
    return run(this.database, principal, (tx) => givePermission(tx, studentId, sessionId, data));
  }

  @Post('permissions/:permissionId/withdraw')
  @HttpCode(200)
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('permissionId', new ParseUUIDPipe()) permissionId: string,
  ) {
    return run(this.database, principal, (tx) => withdrawPermission(tx, studentId, permissionId));
  }
}

/** Trips for the school's staff: who is coming, with permission and emergency contact. */
@Controller('school-life/trips')
export class TripParticipantsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  participants(@CurrentPrincipal() principal: Principal, @Query() query: unknown): Promise<TripParticipants> {
    const range = parse(rangeSchema, query);
    return run(this.database, principal, async (tx) => {
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission_anywhere('bookings.read') AS ok`,
      );
      if (!allowed?.ok) throw new TripsRejected(403, 'trip lists are for school staff');
      return tripParticipants(tx, { from: range.from ?? (await defaultFrom(tx)), days: range.days });
    });
  }

  /** A permission a guardian gave on paper or in person, recorded by staff with consent.manage. */
  @Post(':sessionId/permissions')
  @HttpCode(201)
  record(
    @CurrentPrincipal() principal: Principal,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @Body() body: unknown,
  ) {
    const data = parse(recordSchema, body);
    return run(this.database, principal, (tx) => recordPermission(tx, sessionId, data));
  }
}

/** The consent wording of a trip, on the school's set-up page. */
@Controller('admin/schools/:schoolId/offerings/:offeringId/trip-consent')
export class TripConsentController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Put()
  wording(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @Body() body: unknown,
  ) {
    const { text } = parse(wordingSchema, body);
    return run(this.database, principal, (tx) => setTripConsent(tx, schoolId, offeringId, text));
  }
}
