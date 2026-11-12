import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type SchoolInventory, type StockKind } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { parse, Refused, runner } from '../common/school-work';
import { Database, type PersonTransaction } from '../database/database';

// Books, equipment and supplies of one school, and the group's suppliers. The
// database keeps the count from the movements and never lets it go below zero.

const run = runner({
  PY030: [409, 'not enough of this item in stock'],
  '23505': [409, 'this already exists'],
  '23503': [422, 'choose an item or supplier of this school'],
});

export const itemSchema = z.object({
  kind: z.enum(['book', 'equipment', 'supply']),
  name: z.string().trim().min(1).max(160),
  reorderLevel: z.number().int().min(0).max(100000),
  supplierId: z.uuid().nullable(),
});
export const movementSchema = z
  .object({
    itemId: z.uuid(),
    reason: z.enum(['delivered', 'issued', 'returned', 'lost', 'counted']),
    quantity: z.number().int().min(-100000).max(100000),
  })
  .refine((move) => move.quantity !== 0, { message: 'the quantity is zero' })
  .refine((move) => move.reason === 'counted' || move.quantity > 0, {
    message: 'give a positive quantity',
  });
export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.email().nullable(),
  phone: z.string().trim().min(3).max(40).nullable(),
});

/** What a movement does to the count: deliveries and returns add, the rest take away. */
export const stockChange = (reason: string, quantity: number): number =>
  reason === 'issued' || reason === 'lost' ? -quantity : quantity;

async function school(tx: PersonTransaction, schoolId: string) {
  const [row] = await tx.query<{ id: string; name: string; group_id: string; can_manage: boolean }>(
    `SELECT id, name, group_id, access.has_permission('inventory.manage', id) AS can_manage
       FROM org.school WHERE id = $1 AND access.has_permission('inventory.read', id)`,
    [schoolId],
  );
  if (!row) throw new Refused(404, 'no such school, or not yours to see');
  return row;
}

@Controller('schools/:schoolId')
export class InventoryController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('inventory')
  inventory(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ): Promise<SchoolInventory> {
    return run(this.database, principal, async (tx) => {
      const found = await school(tx, schoolId);
      const items = await tx.query<{
        id: string;
        kind: StockKind;
        name: string;
        on_hand: number;
        reorder_level: number;
        supplier: string | null;
      }>(
        `SELECT i.id, i.kind, i.name, i.on_hand, i.reorder_level, s.name AS supplier
           FROM inventory.item i LEFT JOIN inventory.supplier s ON s.id = i.supplier_id
          WHERE i.school_id = $1 ORDER BY i.kind, i.name`,
        [schoolId],
      );
      const suppliers = await tx.query<{
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
      }>(`SELECT id, name, email, phone FROM inventory.supplier ORDER BY name`);
      return {
        school: { id: found.id, name: found.name },
        canManage: found.can_manage,
        items: items.map((item) => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          onHand: item.on_hand,
          reorderLevel: item.reorder_level,
          supplier: item.supplier,
        })),
        suppliers,
      };
    });
  }

  @Post('inventory/items')
  @HttpCode(201)
  addItem(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(itemSchema, body);
    return run(this.database, principal, async (tx) => {
      const found = await school(tx, schoolId);
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO inventory.item (group_id, school_id, kind, name, reorder_level, supplier_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [found.group_id, schoolId, data.kind, data.name, data.reorderLevel, data.supplierId],
      );
      return row!;
    });
  }

  @Post('inventory/movements')
  @HttpCode(201)
  move(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(movementSchema, body);
    return run(this.database, principal, async (tx) => {
      const found = await school(tx, schoolId);
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO inventory.movement (group_id, school_id, item_id, reason, change, moved_by)
         VALUES ($1, $2, $3, $4, $5, app.current_person_id()) RETURNING id`,
        [found.group_id, schoolId, data.itemId, data.reason, stockChange(data.reason, data.quantity)],
      );
      return row!;
    });
  }

  @Post('suppliers')
  @HttpCode(201)
  addSupplier(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(supplierSchema, body);
    return run(this.database, principal, async (tx) => {
      const found = await school(tx, schoolId);
      const [row] = await tx.query<{ id: string }>(
        `INSERT INTO inventory.supplier (group_id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING id`,
        [found.group_id, data.name, data.email, data.phone],
      );
      return row!;
    });
  }
}
