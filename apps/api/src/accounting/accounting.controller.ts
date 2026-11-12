import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import { type AccountingCompanies, type AccountingSummary, type LedgerEntryKind } from '@pythagoras/shared';
import { type Response } from 'express';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import { type LedgerEntry, ledgerCsv } from './ledger-csv';

// The accounting export (M7.4): a company's ledger for a period, for group
// finance, as the platform's own documented CSV until the accountants confirm
// their format. The database checks the permission and logs every export.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
export const periodSchema = z.strictObject({ companyId: z.uuid(), from: day, to: day });

function period(query: unknown) {
  const parsed = periodSchema.safeParse(query);
  if (!parsed.success)
    throw new BadRequestException('give the company and the period (from and to, YYYY-MM-DD)');
  return parsed.data;
}

async function entries(tx: PersonTransaction, companyId: string, from: string, to: string) {
  return tx.query<LedgerEntry>(
    `SELECT entry_id, to_char(local_date, 'YYYY-MM-DD') AS local_date, entry, payment_mode, order_number, school_code,
            school_name, service_code, description, to_char(service_date, 'YYYY-MM-DD') AS service_date, currency,
            amount_minor::text AS amount_minor, payment_provider, payment_reference, refund_id, credit_id
       FROM commerce.accounting_entries($1, $2::date, $3::date)`,
    [companyId, from, to],
  );
}

/** Pure: totals per currency, mode and kind, and the net per currency and mode. */
export function summarise(
  rows: readonly LedgerEntry[],
): Pick<AccountingSummary, 'entries' | 'totals' | 'net'> {
  const totals = new Map<string, AccountingSummary['totals'][number]>();
  const net = new Map<string, AccountingSummary['net'][number]>();
  for (const row of rows) {
    const mode = row.payment_mode as 'live' | 'test';
    const kind = row.entry as LedgerEntryKind;
    const amount = Number(row.amount_minor);
    const key = `${row.currency}|${mode}|${kind}`;
    const total = totals.get(key) ?? { currency: row.currency, mode, kind, amountMinor: 0, entries: 0 };
    total.amountMinor += amount;
    total.entries += 1;
    totals.set(key, total);
    const netKey = `${row.currency}|${mode}`;
    const sum = net.get(netKey) ?? { currency: row.currency, mode, amountMinor: 0 };
    sum.amountMinor += amount;
    net.set(netKey, sum);
  }
  return { entries: rows.length, totals: [...totals.values()], net: [...net.values()] };
}

@Controller('accounting')
export class AccountingController {
  constructor(@Inject(Database) private readonly database: Database) {}

  private run<T>(principal: Principal, work: (tx: PersonTransaction) => Promise<T>): Promise<T> {
    return this.database.withPerson(principal, work).catch((error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === '42501') throw new ForbiddenException('for group finance');
      if (code === 'P0002') throw new NotFoundException('no such company');
      if (code === '22023') throw new BadRequestException('a period of one day to a year');
      throw error;
    });
  }

  /** The group's companies, for those who export. */
  @Get('companies')
  companies(@CurrentPrincipal() principal: Principal): Promise<AccountingCompanies> {
    return this.run(principal, async (tx) => {
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission('accounting.export') AS ok`,
      );
      if (!allowed?.ok) throw new ForbiddenException('for group finance');
      const rows = await tx.query<{ id: string; legal_name: string; registration_number: string }>(
        `SELECT id, legal_name, registration_number FROM org.legal_entity
          WHERE group_id = access.current_group_id() ORDER BY legal_name`,
      );
      return {
        companies: rows.map((row) => ({
          id: row.id,
          legalName: row.legal_name,
          registrationNumber: row.registration_number,
        })),
      };
    });
  }

  @Get('summary')
  summary(@CurrentPrincipal() principal: Principal, @Query() query: unknown): Promise<AccountingSummary> {
    const { companyId, from, to } = period(query);
    return this.run(principal, async (tx) => {
      const rows = await entries(tx, companyId, from, to);
      const [company] = await tx.query<{ legal_name: string }>(
        'SELECT legal_name FROM org.legal_entity WHERE id = $1',
        [companyId],
      );
      return {
        company: { id: companyId, legalName: company?.legal_name ?? '' },
        from,
        to,
        ...summarise(rows),
      };
    });
  }

  /** The CSV itself, as an attachment. */
  @Get('export')
  async export(
    @CurrentPrincipal() principal: Principal,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const { companyId, from, to } = period(query);
    const csv = await this.run(principal, async (tx) => ledgerCsv(await entries(tx, companyId, from, to)));
    response.set({
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="ledger-${companyId.slice(0, 8)}-${from}-${to}.csv"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    return csv;
  }
}
