import { type SchoolId, type SchoolUniforms, type UniformProduct } from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Uniforms (M4.6, ADR 0025): products with variants, a price per variant and
// stock per school. The database keeps the counts and never oversells; these
// queries read them and call its functions for stock and hand-overs.

export class UniformsRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [UniformsRejected['status'], string]> = {
  P0002: [404, 'no such item at this school'],
  '42501': [403, 'not permitted'],
  '23505': [409, 'a variant with this code already exists'],
  '23514': [422, 'variants are for uniform products'],
  '22023': [422, 'a delivery adds items; a correction adds or removes them'],
  PY001: [409, 'only paid items not yet handed over can be handed over'],
  PY019: [409, 'that would leave fewer items than are held for orders'],
};

export async function refusalsAsUniforms<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal) throw new UniformsRejected(refusal[0], refusal[1]);
    throw error;
  }
}

export interface VariantRow {
  offering_id: string;
  offering_name: string;
  school_id: string;
  school_name: string;
  billing_entity_id: string;
  billing_entity_name: string;
  variant_id: string;
  sku: string;
  size: string | null;
  colour: string | null;
  price_version_id: string;
  unit_amount_minor: string;
  currency: string;
  vat_rate_bp: number;
  free: number;
}

/** Published uniform variants with their current price and free stock, at these schools. */
export function findUniformVariants(
  tx: PersonTransaction,
  schoolIds: readonly string[],
  offeringIds?: readonly string[],
): Promise<VariantRow[]> {
  return tx.query<VariantRow>(
    `SELECT o.id AS offering_id, o.name AS offering_name, o.school_id, s.name AS school_name,
            o.billing_entity_id, le.legal_name AS billing_entity_name,
            v.id AS variant_id, v.sku, v.size, v.colour,
            pv.id AS price_version_id, pv.unit_amount_minor, pv.currency, pv.vat_rate_bp,
            v.on_hand - v.reserved - v.allocated AS free
       FROM catalog.product_variant v
       JOIN catalog.school_offering o ON o.id = v.offering_id AND o.status = 'published'
       JOIN catalog.service_definition d ON d.id = o.service_definition_id AND d.kind = 'uniform'
       JOIN org.school s ON s.id = o.school_id
       JOIN org.legal_entity le ON le.id = o.billing_entity_id
       JOIN LATERAL (SELECT * FROM catalog.price_version p
                      WHERE p.variant_id = v.id AND p.valid_from <= now() AND (p.valid_until IS NULL OR p.valid_until > now())
                      ORDER BY p.valid_from DESC LIMIT 1) pv ON true
      WHERE v.status = 'active' AND o.school_id = ANY ($1::uuid[])
        AND ($2::uuid[] IS NULL OR o.id = ANY ($2::uuid[]))
      ORDER BY s.name, o.name, v.size NULLS LAST, v.sku`,
    [schoolIds, offeringIds ?? null],
  );
}

/** Variant rows grouped as products, for the family's catalogue. */
export function asProducts(rows: readonly VariantRow[]): UniformProduct[] {
  const products = new Map<string, UniformProduct>();
  for (const row of rows) {
    const product = products.get(row.offering_id) ?? {
      id: row.offering_id,
      name: row.offering_name,
      school: { id: row.school_id as SchoolId, name: row.school_name },
      billingEntity: { id: row.billing_entity_id, name: row.billing_entity_name },
      variants: [],
    };
    product.variants.push({
      id: row.variant_id,
      sku: row.sku,
      size: row.size,
      colour: row.colour,
      price: { unitAmountMinor: Number(row.unit_amount_minor), currency: row.currency },
      available: Math.max(0, row.free),
    });
    products.set(row.offering_id, product);
  }
  return [...products.values()];
}

/** Products, variants and their stock, and paid items waiting to be handed over, for staff. */
export async function schoolUniforms(
  tx: PersonTransaction,
  schoolId: string,
): Promise<SchoolUniforms | null> {
  const [school] = await tx.query<{
    id: SchoolId;
    name: string;
    can_manage: boolean;
    can_hand_over: boolean;
    can_see: boolean;
  }>(
    `SELECT id, name, access.has_permission('catalog.manage', id) AS can_manage,
            access.has_permission('bookings.manage', id) AS can_hand_over,
            access.has_permission('bookings.read', id) OR access.has_permission('catalog.read', id) AS can_see
       FROM org.school WHERE id = $1`,
    [schoolId],
  );
  if (!school?.can_see) return null;
  const variants = await tx.query<{
    offering_id: string;
    offering_name: string;
    id: string;
    sku: string;
    size: string | null;
    colour: string | null;
    on_hand: number;
    reserved: number;
    allocated: number;
    low_stock_threshold: number;
    status: string;
    unit_amount_minor: string | null;
    currency: string | null;
  }>(
    `SELECT o.id AS offering_id, o.name AS offering_name, v.id, v.sku, v.size, v.colour, v.on_hand, v.reserved,
            v.allocated, v.low_stock_threshold, v.status, pv.unit_amount_minor, pv.currency
       FROM catalog.school_offering o
       JOIN catalog.service_definition d ON d.id = o.service_definition_id AND d.kind = 'uniform'
       LEFT JOIN catalog.product_variant v ON v.offering_id = o.id
       LEFT JOIN LATERAL (SELECT p.unit_amount_minor, p.currency FROM catalog.price_version p
                           WHERE p.variant_id = v.id AND p.valid_from <= now() AND (p.valid_until IS NULL OR p.valid_until > now())
                           ORDER BY p.valid_from DESC LIMIT 1) pv ON true
      WHERE o.school_id = $1 AND o.status <> 'archived'
      ORDER BY o.name, v.size NULLS LAST, v.sku`,
    [schoolId],
  );
  const waiting = await tx.query<{
    id: string;
    quantity: number;
    offering_name: string;
    sku: string;
    size: string | null;
    given_name: string | null;
    family_name: string | null;
    class_label: string | null;
    confirmed_at: Date | null;
  }>(
    `SELECT r.id, r.quantity, o.name AS offering_name, v.sku, v.size, p.given_name, p.family_name, e.class_label, r.confirmed_at
       FROM commerce.stock_reservation r
       JOIN catalog.product_variant v ON v.id = r.variant_id
       JOIN catalog.school_offering o ON o.id = v.offering_id
       LEFT JOIN people.person p ON p.id = r.student_person_id
       LEFT JOIN people.enrolment e ON e.student_person_id = r.student_person_id AND e.school_id = r.school_id
            AND e.status = 'active'
      WHERE r.school_id = $1 AND r.status = 'confirmed'
      ORDER BY r.confirmed_at, p.family_name`,
    [schoolId],
  );
  const products = new Map<string, SchoolUniforms['products'][number]>();
  for (const row of variants) {
    const product = products.get(row.offering_id) ?? {
      id: row.offering_id,
      name: row.offering_name,
      variants: [],
    };
    if (row.id) {
      const free = row.on_hand - row.reserved - row.allocated;
      product.variants.push({
        id: row.id,
        sku: row.sku,
        size: row.size,
        colour: row.colour,
        price:
          row.unit_amount_minor === null
            ? null
            : { unitAmountMinor: Number(row.unit_amount_minor), currency: row.currency! },
        onHand: row.on_hand,
        reserved: row.reserved,
        allocated: row.allocated,
        free,
        lowStock: row.status === 'active' && free <= row.low_stock_threshold,
        lowStockThreshold: row.low_stock_threshold,
        active: row.status === 'active',
      });
    }
    products.set(row.offering_id, product);
  }
  return {
    school: { id: school.id, name: school.name },
    canManage: school.can_manage,
    canHandOver: school.can_hand_over,
    products: [...products.values()],
    awaitingHandOver: waiting.map((row) => ({
      reservationId: row.id,
      product: row.offering_name,
      variant: row.size ?? row.sku,
      quantity: row.quantity,
      studentName: row.given_name ? [row.given_name, row.family_name].filter(Boolean).join(' ') : null,
      classLabel: row.class_label,
      paidAt: row.confirmed_at?.toISOString() ?? null,
    })),
  };
}

export async function addVariant(
  tx: PersonTransaction,
  schoolId: string,
  body: {
    offeringId: string;
    sku: string;
    size?: string;
    colour?: string;
    unitAmountMinor: number;
    lowStockThreshold?: number;
  },
): Promise<{ variantId: string; priceVersionId: string }> {
  const [offering] = await tx.query<{ group_id: string }>(
    'SELECT group_id FROM catalog.school_offering WHERE id = $1 AND school_id = $2',
    [body.offeringId, schoolId],
  );
  if (!offering) throw new UniformsRejected(404, 'no such product at this school');
  const [variant] = await tx.query<{ id: string }>(
    `INSERT INTO catalog.product_variant (group_id, school_id, offering_id, sku, size, colour, low_stock_threshold)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      offering.group_id,
      schoolId,
      body.offeringId,
      body.sku,
      body.size ?? null,
      body.colour ?? null,
      body.lowStockThreshold ?? 3,
    ],
  );
  const [price] = await tx.query<{ id: string }>(
    `INSERT INTO catalog.price_version
       (group_id, offering_id, variant_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from, created_by_person_id)
     VALUES ($1, $2, $3, 1, $4, 0, 'one_off', now(), app.current_person_id()) RETURNING id`,
    [offering.group_id, body.offeringId, variant!.id, body.unitAmountMinor],
  );
  return { variantId: variant!.id, priceVersionId: price!.id };
}

export async function adjustStock(
  tx: PersonTransaction,
  schoolId: string,
  variantId: string,
  body: { kind: 'delivery' | 'correction'; delta: number; reason: string },
): Promise<{ variantId: string; onHand: number }> {
  const [variant] = await tx.query('SELECT 1 FROM catalog.product_variant WHERE id = $1 AND school_id = $2', [
    variantId,
    schoolId,
  ]);
  if (!variant) throw new UniformsRejected(404, 'no such variant at this school');
  const [row] = await tx.query<{ on_hand: number }>(
    'SELECT catalog.adjust_stock($1, $2, $3, $4) AS on_hand',
    [variantId, body.kind, body.delta, body.reason],
  );
  return { variantId, onHand: row!.on_hand };
}

export async function handOver(
  tx: PersonTransaction,
  schoolId: string,
  reservationId: string,
): Promise<{ reservationId: string; status: 'handed_over' }> {
  const [reservation] = await tx.query(
    'SELECT 1 FROM commerce.stock_reservation WHERE id = $1 AND school_id = $2',
    [reservationId, schoolId],
  );
  if (!reservation) throw new UniformsRejected(404, 'no such paid item at this school');
  await tx.query('SELECT commerce.hand_over_stock($1)', [reservationId]);
  return { reservationId, status: 'handed_over' };
}
