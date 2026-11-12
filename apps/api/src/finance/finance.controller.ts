import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  type ExpenseCategory,
  type GroupOverview,
  type InvoiceDetail,
  type MyInvoices,
  type SchoolFinance,
} from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { parse, Refused, runner } from '../common/school-work';
import { Database, type PersonTransaction } from '../database/database';
import { academicYearOf } from '../timetable/timetable.repository';

// A school's expenses and budget against what it took in, the invoices a family
// has, and one view across the group's schools.

const run = runner({
  '23503': [422, 'choose a supplier of the group'],
});

const CATEGORIES = [
  'materials',
  'food',
  'utilities',
  'maintenance',
  'transport',
  'events',
  'marketing',
  'other',
] as const;

const amount = z.number().int().min(1).max(100_000_000_00);

export const expenseSchema = z.object({
  category: z.enum(CATEGORIES),
  description: z.string().trim().min(1).max(300),
  supplierId: z.uuid().nullable(),
  amountMinor: amount,
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export const budgetSchema = z.object({
  category: z.enum(CATEGORIES),
  amountMinor: amount,
});

/** The first and last day of a school year, as a half-open range. */
export function yearRange(academicYear: string): { from: string; to: string } {
  const start = academicYear.slice(0, 4);
  const end = academicYear.slice(5);
  return { from: `${start}-08-01`, to: `${end}-08-01` };
}

async function school(tx: PersonTransaction, schoolId: string) {
  const [row] = await tx.query<{ id: string; name: string; group_id: string; can_manage: boolean }>(
    `SELECT id, name, group_id, access.has_permission('finance.manage', id) AS can_manage
       FROM org.school WHERE id = $1 AND access.has_permission('finance.read', id)`,
    [schoolId],
  );
  if (!row) throw new Refused(404, 'no such school, or not yours to see');
  return row;
}

/** A school's money this school year. */
@Controller('schools/:schoolId/finance')
export class SchoolFinanceController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  finance(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ): Promise<SchoolFinance> {
    const academicYear = academicYearOf(new Date());
    const { from, to } = yearRange(academicYear);
    return run(this.database, principal, async (tx) => {
      const found = await school(tx, schoolId);
      const [income] = await tx.query<{ income: string }>(
        `SELECT finance.school_income($1, $2, $3) AS income`,
        [schoolId, from, to],
      );
      const lines = await tx.query<{ category: ExpenseCategory; budget: string; spent: string }>(
        `SELECT c.category, coalesce(b.amount_minor, 0) AS budget,
                coalesce((SELECT sum(e.amount_minor) FROM finance.expense e
                           WHERE e.school_id = $1 AND e.category = c.category
                             AND e.spent_on >= $3 AND e.spent_on < $4), 0) AS spent
           FROM unnest($5::text[]) AS c (category)
           LEFT JOIN finance.budget b
             ON b.school_id = $1 AND b.academic_year = $2 AND b.category = c.category`,
        [schoolId, academicYear, from, to, CATEGORIES],
      );
      const expenses = await tx.query<{
        id: string;
        category: ExpenseCategory;
        description: string;
        supplier: string | null;
        amount_minor: string;
        spent_on: string;
      }>(
        `SELECT e.id, e.category, e.description, s.name AS supplier, e.amount_minor,
                to_char(e.spent_on, 'YYYY-MM-DD') AS spent_on
           FROM finance.expense e LEFT JOIN inventory.supplier s ON s.id = e.supplier_id
          WHERE e.school_id = $1 ORDER BY e.spent_on DESC, e.id DESC LIMIT 30`,
        [schoolId],
      );
      const suppliers = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM inventory.supplier ORDER BY name`,
      );
      return {
        school: { id: found.id, name: found.name },
        academicYear,
        canManage: found.can_manage,
        currency: 'EUR',
        incomeMinor: Number(income!.income),
        categories: lines.map((line) => ({
          category: line.category,
          budgetMinor: Number(line.budget),
          spentMinor: Number(line.spent),
        })),
        expenses: expenses.map((e) => ({
          id: e.id,
          category: e.category,
          description: e.description,
          supplier: e.supplier,
          amountMinor: Number(e.amount_minor),
          spentOn: e.spent_on,
        })),
        suppliers,
      };
    });
  }

  @Post('expenses')
  @HttpCode(201)
  expense(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(expenseSchema, body);
    return run(this.database, principal, async (tx) => {
      const found = await school(tx, schoolId);
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO finance.expense
           (group_id, school_id, category, description, supplier_id, amount_minor, spent_on, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, app.current_person_id()) RETURNING id`,
        [
          found.group_id,
          schoolId,
          data.category,
          data.description,
          data.supplierId,
          data.amountMinor,
          data.spentOn,
        ],
      );
      return row!;
    });
  }

  @Put('budget')
  @HttpCode(204)
  async budget(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const data = parse(budgetSchema, body);
    await run(this.database, principal, async (tx) => {
      const found = await school(tx, schoolId);
      await tx.query(
        `INSERT INTO finance.budget (group_id, school_id, academic_year, category, amount_minor)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (school_id, academic_year, category) DO UPDATE SET amount_minor = EXCLUDED.amount_minor`,
        [found.group_id, schoolId, academicYearOf(new Date()), data.category, data.amountMinor],
      );
    });
  }
}

interface InvoiceRow {
  id: string;
  number: string;
  issued_on: string;
  currency: string;
  total_minor: string;
  order_number: string;
  company: string;
}

const INVOICES = `
  SELECT i.id, i.number, to_char(i.issued_on, 'YYYY-MM-DD') AS issued_on, i.currency, i.total_minor,
         o.order_number, l.legal_name AS company
    FROM finance.invoice i
    JOIN commerce.customer_order o ON o.id = i.order_id
    JOIN org.legal_entity l ON l.id = i.billing_entity_id`;

const invoiceNumber = (number: string) => number.padStart(10, '0');

const invoiceView = (row: InvoiceRow) => ({
  id: row.id,
  number: invoiceNumber(row.number),
  issuedOn: row.issued_on,
  currency: row.currency,
  totalMinor: Number(row.total_minor),
  orderNumber: row.order_number,
  company: row.company,
});

/** The invoices of the signed-in person. */
@Controller('me/invoices')
export class MyInvoicesController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal): Promise<MyInvoices> {
    return run(this.database, principal, async (tx) => {
      const rows = await tx.query<InvoiceRow>(
        `${INVOICES} WHERE i.payer_person_id = app.current_person_id() ORDER BY i.issued_on DESC, i.number DESC`,
      );
      return { invoices: rows.map(invoiceView) };
    });
  }

  @Get(':invoiceId')
  detail(
    @CurrentPrincipal() principal: Principal,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<InvoiceDetail> {
    return run(this.database, principal, async (tx) => {
      const [row] = await tx.query<
        InvoiceRow & {
          registration_number: string;
          vat_number: string | null;
          registered_address: string | null;
          order_id: string;
          given_name: string;
          family_name: string;
        }
      >(
        `SELECT i.id, i.number, to_char(i.issued_on, 'YYYY-MM-DD') AS issued_on, i.currency, i.total_minor,
                o.order_number, o.id AS order_id, l.legal_name AS company, l.registration_number, l.vat_number,
                l.registered_address, p.given_name, p.family_name
           FROM finance.invoice i
           JOIN commerce.customer_order o ON o.id = i.order_id
           JOIN org.legal_entity l ON l.id = i.billing_entity_id
           JOIN people.person p ON p.id = i.payer_person_id
          WHERE i.id = $1`,
        [invoiceId],
      );
      if (!row) throw new Refused(404, 'no such invoice, or not yours to see');
      const lines = await tx.query<{
        description: string;
        quantity: number;
        unit_amount_minor: string;
        line_total_minor: string;
        vat_rate_bp: number;
      }>(
        `SELECT description, quantity, unit_amount_minor, line_total_minor, vat_rate_bp
           FROM commerce.order_line WHERE order_id = $1 ORDER BY line_no`,
        [row.order_id],
      );
      return {
        ...invoiceView(row),
        registrationNumber: row.registration_number,
        vatNumber: row.vat_number,
        address: row.registered_address,
        billedTo: `${row.given_name} ${row.family_name}`,
        lines: lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitMinor: Number(line.unit_amount_minor),
          totalMinor: Number(line.line_total_minor),
          vatRateBp: line.vat_rate_bp,
        })),
      };
    });
  }
}

/** Every school on one screen, for those who run the group. */
@Controller('group/overview')
export class GroupOverviewController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  overview(@CurrentPrincipal() principal: Principal): Promise<GroupOverview> {
    const academicYear = academicYearOf(new Date());
    const { from, to } = yearRange(academicYear);
    return run(this.database, principal, async (tx) => {
      const rows = await tx.query<{
        id: string;
        name: string;
        children: number;
        places: number;
        seats: number;
        classes: number;
        full_classes: number;
        waiting: number;
        low_stock: number;
        income: string;
        spent: string;
        budget: string;
      }>(
        `SELECT s.id, s.name,
                (SELECT count(*)::int FROM people.enrolment e
                  WHERE e.school_id = s.id AND e.academic_year = $1 AND e.status = 'active') AS children,
                coalesce(k.places, 0)::int AS places, coalesce(k.seats, 0)::int AS seats,
                coalesce(k.classes, 0)::int AS classes, coalesce(k.full_classes, 0)::int AS full_classes,
                (SELECT count(*)::int FROM scheduling.waiting_entry w
                  WHERE w.school_id = s.id AND w.status IN ('waiting', 'place_free')) AS waiting,
                (SELECT count(*)::int FROM inventory.item i
                  WHERE i.school_id = s.id AND i.on_hand <= i.reorder_level) AS low_stock,
                finance.school_income(s.id, $2, $3) AS income,
                (SELECT coalesce(sum(e.amount_minor), 0) FROM finance.expense e
                  WHERE e.school_id = s.id AND e.spent_on >= $2 AND e.spent_on < $3) AS spent,
                (SELECT coalesce(sum(b.amount_minor), 0) FROM finance.budget b
                  WHERE b.school_id = s.id AND b.academic_year = $1) AS budget
           FROM org.school s
           LEFT JOIN LATERAL (
             SELECT count(*) AS classes, sum(c.capacity) AS places, sum(t.seats) AS seats,
                    count(*) FILTER (WHERE t.seats >= c.capacity) AS full_classes
               FROM scheduling.school_class c
              CROSS JOIN LATERAL (
                SELECT count(*) AS seats FROM people.enrolment e
                 WHERE e.class_id = c.id AND e.status IN ('active', 'suspended')
              ) t
              WHERE c.school_id = s.id AND c.academic_year = $1 AND c.status = 'active'
           ) k ON true
          WHERE s.status = 'active' AND access.has_permission('finance.read', s.id)
            AND access.has_permission('enrolment.read', s.id)
          ORDER BY s.name`,
        [academicYear, from, to],
      );
      if (rows.length < 2) throw new Refused(403, 'this page is for those who run the group');
      return {
        academicYear,
        currency: 'EUR',
        schools: rows.map((row) => ({
          id: row.id,
          name: row.name,
          children: row.children,
          places: row.places,
          seatsTaken: row.seats,
          classes: row.classes,
          fullClasses: row.full_classes,
          waiting: row.waiting,
          lowStock: row.low_stock,
          incomeMinor: Number(row.income),
          spentMinor: Number(row.spent),
          budgetMinor: Number(row.budget),
        })),
      };
    });
  }
}
