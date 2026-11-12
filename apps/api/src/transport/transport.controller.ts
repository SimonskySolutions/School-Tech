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
import { type SchoolTransport, type TransportRuns } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import { defaultFrom } from '../school-life/school-life.repository';
import {
  addStop,
  createRoute,
  refusalsAsTransport,
  schoolTransport,
  TransportRejected,
  transportRuns,
} from './transport.repository';

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
export const routeSchema = z.object({
  offeringId: z.uuid(),
  vehicle: z.string().trim().min(1).max(120).optional(),
  weekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(7)
    .transform((days) => [...new Set(days)].sort()),
});
export const stopSchema = z.object({
  name: z.string().trim().min(1).max(120),
  pickupTime: clock,
  dropoffTime: clock.optional(),
});
const dateSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
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
    return await refusalsAsTransport(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof TransportRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    if (error.status === 409) throw new ConflictException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

/** A school's bus routes, their stops and terms (M4.5). */
@Controller('schools/:schoolId')
export class SchoolTransportController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('transport')
  overview(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ): Promise<SchoolTransport> {
    return run(this.database, principal, async (tx) => {
      const found = await schoolTransport(tx, schoolId);
      if (!found) throw new TransportRejected(404, 'no such school, or not yours to see');
      return found;
    });
  }

  @Post('transport-routes')
  @HttpCode(201)
  route(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(routeSchema, body);
    return run(this.database, principal, (tx) => createRoute(tx, schoolId, data));
  }

  @Post('transport-routes/:offeringId/stops')
  @HttpCode(201)
  stop(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @Body() body: unknown,
  ) {
    const data = parse(stopSchema, body);
    return run(this.database, principal, (tx) => addStop(tx, schoolId, offeringId, data));
  }
}

/** The day's list for each route's driver: stops in order and who boards (M4.5). */
@Controller('school-life/transport')
export class TransportRunsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  runs(@CurrentPrincipal() principal: Principal, @Query() query: unknown): Promise<TransportRuns> {
    const { date } = parse(dateSchema, query);
    return run(this.database, principal, async (tx) => {
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission_anywhere('bookings.read') AS ok`,
      );
      if (!allowed?.ok) throw new TransportRejected(403, 'transport lists are for school staff');
      return transportRuns(tx, date ?? (await defaultFrom(tx)));
    });
  }
}
