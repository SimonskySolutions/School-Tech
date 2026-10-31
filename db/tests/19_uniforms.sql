-- Uniforms: variants, per-variant prices and stock that is never oversold (M4.6).
BEGIN;
\ir _fixtures.sql
\echo '# 19 uniforms and stock'
\set POLOD  '''50000000-0000-7000-8000-000000000019'''
\set POLO   '''60000000-0000-7000-8000-000000000020'''
\set V1     '''95000000-0000-7000-8000-000000000001'''
\set V2     '''95000000-0000-7000-8000-000000000002'''
\set PV1    '''70000000-0000-7000-8000-000000000021'''
\set PV2    '''70000000-0000-7000-8000-000000000022'''
\set O1     '''92000000-0000-7000-8000-000000000019'''
\set L1     '''92000000-0000-7000-8000-000000000020'''
\set O2     '''92000000-0000-7000-8000-000000000021'''
\set L2     '''92000000-0000-7000-8000-000000000022'''
\set R1     '''96000000-0000-7000-8000-000000000001'''

RESET ROLE;
INSERT INTO catalog.service_definition (id, group_id, code, kind, name) VALUES (:POLOD, :G, 'polo', 'uniform', 'Polo shirt');
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status)
VALUES (:POLO, :G, :A, :POLOD, :E1, 'polo', 'Polo shirt, School A', 'published');

-- Variants: only for uniforms, added by catalogue staff.
SELECT test.as_person(:ADM);
SELECT test.expect_error(format(
  'INSERT INTO catalog.product_variant (group_id, school_id, offering_id, sku) VALUES (%L,%L,%L,%L)', :G, :A, :CHA, 'CHESS-1'),
  '23514', 'variants are only for uniform products');
INSERT INTO catalog.product_variant (id, group_id, school_id, offering_id, sku, size, colour) VALUES
  (:V1, :G, :A, :POLO, 'POLO-128', '128', 'Navy'),
  (:V2, :G, :A, :POLO, 'POLO-140', '140', 'Navy');
INSERT INTO catalog.price_version (id, group_id, offering_id, variant_id, version, unit_amount_minor, price_unit, valid_from) VALUES
  (:PV1, :G, :POLO, :V1, 1, 2500, 'one_off', now() - interval '1 day'),
  (:PV2, :G, :POLO, :V2, 1, 2800, 'one_off', now() - interval '1 day');
SELECT test.ok(true, 'each variant has its own price version 1');
SELECT test.expect_error(format(
  'INSERT INTO catalog.price_version (group_id, offering_id, variant_id, version, unit_amount_minor, price_unit, valid_from) VALUES (%L,%L,%L,2,2600,%L,now())',
  :G, :POLO, :V1, 'one_off'), '23P01', 'two prices of one variant cannot overlap');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.expect_error(format(
  'INSERT INTO catalog.product_variant (group_id, school_id, offering_id, sku) VALUES (%L,%L,%L,%L)', :G, :A, :POLO, 'POLO-999'),
  '42501', 'the kitchen cannot add variants');

-- Stock comes in through the ledger, only from catalogue staff.
SELECT test.expect_error(format('SELECT catalog.adjust_stock(%L, %L, 5, %L)', :V1, 'delivery', 'Delivery'),
  '42501', 'the kitchen cannot change stock');
RESET ROLE; SELECT test.as_person(:ADM);
SELECT test.ok(catalog.adjust_stock(:V1, 'delivery', 2, 'Delivery (synthetic)') = 2, 'a delivery adds to the stock');
SELECT test.expect_error(format('SELECT catalog.adjust_stock(%L, %L, -1, %L)', :V1, 'delivery', 'Wrong'),
  '22023', 'a delivery cannot remove items');

-- An order holds its items; nobody can buy more than there is.
RESET ROLE; SELECT test.as_person(:P);
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O1, :G, :E1, :P, 'family_portal', 'test-idem-1901', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:L1, :G, :O1, :E1, 1, :A, :POLO, :K1, :PV1, 'Polo shirt, 128', 2, 'EUR', 2500, 0, 5000);
SELECT test.expect_error(format(
  'INSERT INTO commerce.stock_reservation (group_id, school_id, variant_id, order_line_id, student_person_id, quantity, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L,1,%L,now() + interval %L,%L)',
  :G, :A, :V1, :L1, :K1, 'reserved', '30 minutes', :P), '23514', 'a reservation must match its line''s quantity');
SELECT test.expect_error(format(
  'INSERT INTO commerce.stock_reservation (group_id, school_id, variant_id, order_line_id, student_person_id, quantity, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L,2,%L,now() + interval %L,%L)',
  :G, :A, :V2, :L1, :K1, 'reserved', '30 minutes', :P), '23514', 'a reservation must be for the variant the line is priced at');
INSERT INTO commerce.stock_reservation (id, group_id, school_id, variant_id, order_line_id, student_person_id, quantity, status, reserved_until, created_by_person_id)
VALUES (:R1, :G, :A, :V1, :L1, :K1, 2, 'reserved', now() + interval '30 minutes', :P);
RESET ROLE;
SELECT test.ok((SELECT reserved = 2 AND on_hand = 2 FROM catalog.product_variant WHERE id = :V1), 'the order holds both items');

SELECT test.as_person(:Q);
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O2, :G, :E1, :Q, 'family_portal', 'test-idem-1902', :Q);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:L2, :G, :O2, :E1, 1, :A, :POLO, :K3, :PV1, 'Polo shirt, 128', 1, 'EUR', 2500, 0, 2500);
SELECT test.expect_error(format(
  'INSERT INTO commerce.stock_reservation (group_id, school_id, variant_id, order_line_id, student_person_id, quantity, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L,1,%L,now() + interval %L,%L)',
  :G, :A, :V1, :L2, :K3, 'reserved', '30 minutes', :Q), 'PY019', 'the next family cannot buy what is already held');
SELECT test.ok((SELECT count(*) FROM commerce.stock_reservation) = 0, 'another family sees no one else''s reservation');

-- Paid: allocated. Corrections cannot go below what is held.
RESET ROLE;
UPDATE commerce.stock_reservation SET status = 'confirmed', confirmed_at = now() WHERE id = :R1;
SELECT test.ok((SELECT reserved = 0 AND allocated = 2 FROM catalog.product_variant WHERE id = :V1), 'payment moves the items to allocated');
SELECT test.as_person(:ADM);
SELECT test.expect_error(format('SELECT catalog.adjust_stock(%L, %L, -1, %L)', :V1, 'correction', 'Counted one less'),
  'PY019', 'a correction cannot leave fewer items than are sold');
SELECT test.ok(catalog.adjust_stock(:V1, 'delivery', 5, 'Second delivery (synthetic)') = 7, 'a second delivery');

-- Handing over: the school's staff who manage bookings; the items leave the store.
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error(format('SELECT commerce.hand_over_stock(%L)', :R1), 'P0002', 'a teacher at another school cannot see it');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.expect_error(format('SELECT commerce.hand_over_stock(%L)', :R1), '42501', 'the kitchen cannot hand items over');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT commerce.hand_over_stock(:R1);
RESET ROLE;
SELECT test.ok((SELECT on_hand = 5 AND allocated = 0 FROM catalog.product_variant WHERE id = :V1),
  'handing over takes the items out of the store');
SELECT test.ok((SELECT handed_over_by_person_id = :PRA::uuid FROM commerce.stock_reservation WHERE id = :R1),
  'the hand-over records who did it');
SELECT test.ok((SELECT sum(delta) FROM catalog.stock_movement WHERE variant_id = :V1) = 5,
  'the stock ledger adds up to what is in the store');
SELECT test.as_person(:PRA);
SELECT test.expect_error(format('SELECT commerce.hand_over_stock(%L)', :R1), 'PY001', 'items cannot be handed over twice');
RESET ROLE;
SELECT test.expect_error('UPDATE catalog.stock_movement SET delta = 100', 'PY004', 'the stock ledger is permanent');

-- Expiry releases what an unpaid order held; a late payment re-confirms only if the item is still there.
SELECT test.as_person(:ADM);
SELECT catalog.adjust_stock(:V2, 'delivery', 1, 'One shirt (synthetic)');
RESET ROLE; SELECT test.as_person(:P);
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES ('92000000-0000-7000-8000-000000000023', :G, :E1, :P, 'family_portal', 'test-idem-1903', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES ('92000000-0000-7000-8000-000000000024', :G, '92000000-0000-7000-8000-000000000023', :E1, 1, :A, :POLO, :K1, :PV2,
        'Polo shirt, 140', 1, 'EUR', 2800, 0, 2800);
INSERT INTO commerce.stock_reservation (id, group_id, school_id, variant_id, order_line_id, student_person_id, quantity, status, reserved_until, created_by_person_id)
VALUES ('96000000-0000-7000-8000-000000000002', :G, :A, :V2, '92000000-0000-7000-8000-000000000024', :K1, 1, 'reserved',
        now() + interval '30 minutes', :P);
RESET ROLE;
UPDATE commerce.stock_reservation SET status = 'expired', reserved_until = NULL WHERE id = '96000000-0000-7000-8000-000000000002';
SELECT test.ok((SELECT reserved FROM catalog.product_variant WHERE id = :V2) = 0, 'an expired order releases the item');
SELECT test.as_person(:ADM);
SELECT catalog.adjust_stock(:V2, 'correction', -1, 'Damaged (synthetic)');
RESET ROLE;
SELECT test.expect_error(
  'UPDATE commerce.stock_reservation SET status = ''confirmed'', confirmed_at = now() WHERE id = ''96000000-0000-7000-8000-000000000002''',
  'PY019', 'a late payment cannot take an item that is no longer there');

ROLLBACK;
