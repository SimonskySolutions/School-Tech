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
import {
  type ActivityRegisters,
  type CancelBookingResponse,
  type KitchenCounts,
  type LunchList,
} from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import { cancelLunchBooking, CancelRejected, lunchList } from './cancellation';
import { activityRegisters, type DateRange, defaultFrom, kitchenCounts } from './school-life.repository';

const rangeSchema = (defaultDays: number) =>
  z.object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'not a date')
      .optional(),
    days: z.coerce.number().int().min(1).max(31).default(defaultDays),
  });

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'not a date');

const lunchQuery = z.object({ schoolId: z.uuid(), date: day });

// The reason is kept on the booking (audit-redacted: it may say a child is ill).
const cancelBody = z.object({ reason: z.string().trim().min(3).max(200) });

@Controller('school-life')
export class SchoolLifeController {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** Lunches to prepare per school and day, with dietary needs where the viewer may see them. */
  @Get('kitchen')
  kitchen(@CurrentPrincipal() principal: Principal, @Query() query: unknown): Promise<KitchenCounts> {
    return this.read(principal, rangeSchema(5), query, kitchenCounts);
  }

  /** Club sessions and the children booked on them. */
  @Get('registers')
  registers(@CurrentPrincipal() principal: Principal, @Query() query: unknown): Promise<ActivityRegisters> {
    return this.read(principal, rangeSchema(14), query, activityRegisters);
  }

  private read<T>(
    principal: Principal,
    schema: ReturnType<typeof rangeSchema>,
    query: unknown,
    load: (tx: PersonTransaction, range: DateRange) => Promise<T>,
  ): Promise<T> {
    const parsed = schema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('from must be YYYY-MM-DD and days 1-31');
    return this.database.withPerson(principal, async (tx) => {
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission_anywhere('bookings.read') AS ok`,
      );
      if (!allowed?.ok) throw new ForbiddenException('School Life views are for staff');
      const from = parsed.data.from ?? (await defaultFrom(tx));
      return load(tx, { from, days: parsed.data.days });
    });
  }

  /** The children booked for lunch at one school on one day. */
  @Get('lunch')
  lunch(@CurrentPrincipal() principal: Principal, @Query() query: unknown): Promise<LunchList> {
    const parsed = lunchQuery.safeParse(query);
    if (!parsed.success) throw new BadRequestException('schoolId (uuid) and date (YYYY-MM-DD) are required');
    return this.database.withPerson(principal, async (tx) => {
      const list = await lunchList(tx, parsed.data.schoolId, parsed.data.date);
      if (!list) throw new NotFoundException('no such school, or not yours to see');
      return list;
    });
  }

  /** Cancels one paid lunch day; the worker then credits the payer with what was paid for it. */
  @Post('bookings/:bookingId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentPrincipal() principal: Principal,
    @Param('bookingId', new ParseUUIDPipe()) bookingId: string,
    @Body() body: unknown,
  ): Promise<CancelBookingResponse> {
    const parsed = cancelBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException('a reason of 3-200 characters is required');
    try {
      return await this.database.withPerson(principal, (tx) =>
        cancelLunchBooking(tx, bookingId, parsed.data.reason),
      );
    } catch (error) {
      if (!(error instanceof CancelRejected)) throw error;
      const { status, message } = error.refusal;
      if (status === 404) throw new NotFoundException(message);
      if (status === 403) throw new ForbiddenException(message);
      if (status === 409) throw new ConflictException(message);
      throw new UnprocessableEntityException(message);
    }
  }
}
