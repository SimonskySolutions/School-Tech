-- School-specific prices, immutable price history, and frozen order terms.
BEGIN;
\ir _fixtures.sql
\echo '# 05 pricing'
\set O1 '''90000000-0000-7000-8000-000000000001'''
\set O2 '''90000000-0000-7000-8000-000000000002'''
\set PLA2 '''70000000-0000-7000-8000-0000000000a2'''

RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT unit_amount_minor FROM catalog.price_version WHERE offering_id = :LA) = 450
           AND (SELECT unit_amount_minor FROM catalog.price_version WHERE offering_id = :LC) = 500,
  'each school prices lunch independently (A: 4.50, C: 5.00)');

INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O1, :G, :E1, :P, 'family_portal', 'test-idem-0001', :P);
INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
                                 price_version_id, description, service_date, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:G, :O1, :E1, 1, :A, :LA, :SLA, :K1, :PLA1, 'Lunch, 2 Nov', '2026-11-02', 1, 'EUR', 450, 0, 450);
SELECT test.ok(true, 'a parent orders lunch for their child at the current price');

SELECT test.expect_error(format(
  'INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id, price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor) VALUES (%L,%L,%L,2,%L,%L,%L,%L,%L,%L,1,%L,100,0,100)',
  :G, :O1, :E1, :A, :LA, :SLA, :K1, :PLA1, 'Lunch at a made-up price', 'EUR'),
  'PY008', 'an order line must carry the exact price of its price version');
SELECT test.expect_error(format(
  'INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id, price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor) VALUES (%L,%L,%L,2,%L,%L,%L,%L,%L,2,%L,450,0,450)',
  :G, :O1, :E1, :A, :LA, :K1, :PLA1, 'Two lunches with a wrong total', 'EUR'),
  '23514', 'a line total must equal unit price times quantity');
SELECT test.expect_error(format(
  'INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id, price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor) VALUES (%L,%L,%L,2,%L,%L,%L,%L,%L,1,%L,450,0,450)',
  :G, :O1, :E1, :A, :LA, :K3, :PLA1, 'Lunch for someone else''s child', 'EUR'),
  '42501', 'a parent cannot order for a child they are not authorised to pay for');

SELECT test.expect_error(format('UPDATE commerce.customer_order SET status = %L, placed_at = now(), total_minor = 999 WHERE id = %L', 'pending_payment', :O1),
  'PY008', 'an order cannot be placed with a total that differs from its lines');
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 450, expires_at = now() + interval '30 minutes'
 WHERE id = :O1;
SELECT test.ok((SELECT status FROM commerce.customer_order WHERE id = :O1) = 'pending_payment', 'an order with a matching total is placed');
SELECT test.expect_error(format('UPDATE commerce.order_line SET quantity = 2, line_total_minor = 900 WHERE order_id = %L', :O1),
  '42501', 'the API cannot change the quantity of a line (no column privilege)');
RESET ROLE;
SELECT test.expect_error(format('UPDATE commerce.order_line SET description = %L WHERE order_id = %L', 'changed', :O1),
  'PY004', 'lines of a placed order are frozen, even for the owner');

-- The School Life coordinator changes the School A lunch price.
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.expect_error(format('UPDATE catalog.price_version SET unit_amount_minor = 999 WHERE id = %L', :PLA1),
  '42501', 'the API has no privilege to rewrite a price');
RESET ROLE;
SELECT test.expect_error(format('UPDATE catalog.price_version SET unit_amount_minor = 999 WHERE id = %L', :PLA1),
  'PY004', 'a price version is immutable even for the owner');
SELECT test.as_person(:SL);
UPDATE catalog.price_version SET valid_until = now() WHERE id = :PLA1;
INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from, created_by_person_id)
VALUES (:PLA2, :G, :LA, 2, 600, 0, 'per_day', now(), :SL);
SELECT test.ok(true, 'a new price is introduced by closing the old version and adding a new one');
SELECT test.expect_error(format(
  'INSERT INTO catalog.price_version (group_id, offering_id, version, unit_amount_minor, price_unit, valid_from) VALUES (%L,%L,3,700,%L, now() - interval %L)',
  :G, :LA, 'per_day', '1 day'), '23P01', 'overlapping price versions are rejected');
SELECT test.expect_error(format('UPDATE catalog.price_version SET valid_until = now() - interval %L WHERE id = %L', '1 hour', :PLA2),
  'PY004', 'a price version cannot be closed in the past');

RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT line_total_minor FROM commerce.order_line WHERE order_id = :O1) = 450,
  'the existing order keeps the price agreed when it was placed');
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O2, :G, :E1, :P, 'family_portal', 'test-idem-0002', :P);
SELECT test.expect_error(format(
  'INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id, price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor) VALUES (%L,%L,%L,1,%L,%L,%L,%L,%L,1,%L,450,0,450)',
  :G, :O2, :E1, :A, :LA, :K1, :PLA1, 'Lunch at the old price', 'EUR'),
  'PY008', 'a closed price version cannot be used for new orders');
INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:G, :O2, :E1, 1, :A, :LA, :K1, :PLA2, 'Lunch at the new price', 1, 'EUR', 600, 0, 600);
SELECT test.ok((SELECT line_total_minor FROM commerce.order_line WHERE order_id = :O2) = 600, 'new orders use the new price');
SELECT test.expect_error(format(
  'INSERT INTO commerce.customer_order (group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id) VALUES (%L,%L,%L,%L,%L,%L)',
  :G, :E1, :P, 'family_portal', 'test-idem-0002', :P), '23505', 'a repeated idempotency key cannot create a second order');

ROLLBACK;
