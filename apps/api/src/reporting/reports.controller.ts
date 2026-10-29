import { BadRequestException, Controller, ForbiddenException, Get, Inject, Query } from '@nestjs/common';
import { type RevenueReport } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database } from '../database/database';
import { currentMonth, loadRevenueReport } from './revenue-report';

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'not a date');

const MAX_DAYS = 366;

const querySchema = z
  .object({ from: day.optional(), to: day.optional() })
  .refine(
    (query) => (query.from === undefined) === (query.to === undefined),
    'give both from and to, or neither',
  )
  .refine(
    (query) =>
      !query.from ||
      !query.to ||
      (query.from <= query.to && (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 < MAX_DAYS),
    `from must not be after to, and the period at most ${MAX_DAYS} days`,
  );

@Controller('reports')
export class ReportsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** Revenue per school for a period (local dates, default this month) and today's open balances. */
  @Get('revenue')
  revenue(@CurrentPrincipal() principal: Principal, @Query() query: unknown): Promise<RevenueReport> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'invalid period');
    return this.database.withPerson(principal, async (tx) => {
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission_anywhere('reports.read') AS ok`,
      );
      if (!allowed?.ok) throw new ForbiddenException('reports are for management and finance staff');
      const { from, to } = parsed.data;
      return loadRevenueReport(tx, from && to ? { from, to } : await currentMonth(tx));
    });
  }
}
