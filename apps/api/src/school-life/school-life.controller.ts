import { BadRequestException, Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { type ActivityRegisters, type KitchenCounts } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
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
}
