-- Orders, lines, payments and allocations always belong to the right billing entity.
BEGIN;
\ir _fixtures.sql
\echo '# 08 billing entities'
\set O1 '''90000000-0000-7000-8000-000000000001'''
\set O2 '''90000000-0000-7000-8000-000000000002'''
\set CG '''9f000000-0000-7000-8000-000000000001'''
\set L1 '''91000000-0000-7000-8000-000000000001'''

RESET ROLE; SELECT test.as_person(:P);
-- One basket with lunch at School A (E1) and at Kindergarten C (E2) becomes two orders.
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, checkout_group_id, origin, idempotency_key, created_by_person_id)
VALUES (:O1, :G, :E1, :P, :CG, 'family_portal', 'test-idem-0201', :P),
       (:O2, :G, :E2, :P, :CG, 'family_portal', 'test-idem-0202', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:L1, :G, :O1, :E1, 1, :A, :LA, :SLA, :K1, :PLA1, 'Lunch, School A', 1, 'EUR', 450, 0, 450);
INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:G, :O2, :E2, 1, :C, :LC, :SLC, :K2, :PLC1, 'Lunch, Kindergarten C', 1, 'EUR', 500, 0, 500);
SELECT test.ok((SELECT count(DISTINCT billing_entity_id) FROM commerce.customer_order WHERE checkout_group_id = :CG) = 2,
  'a basket spanning two companies is split into one order per billing entity');

SELECT test.expect_error(format(
  'INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id, price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor) VALUES (%L,%L,%L,2,%L,%L,%L,%L,%L,1,%L,500,0,500)',
  :G, :O1, :E1, :C, :LC, :K2, :PLC1, 'Kindergarten C lunch on the School A company order', 'EUR'),
  '23503', 'an order line cannot sell an offering billed by another company');
SELECT test.expect_error(format(
  'INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id, price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor) VALUES (%L,%L,%L,2,%L,%L,%L,%L,%L,1,%L,450,0,450)',
  :G, :O1, :E1, :B, :LA, :K1, :PLA1, 'School A lunch booked as School B', 'EUR'),
  '23503', 'an order line cannot claim a different school than its offering');
SELECT test.expect_error(format(
  'INSERT INTO commerce.payment (group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency) VALUES (%L,%L,%L,%L,%L,450,%L)',
  :G, :O1, :E2, 'stripe', 'test', 'EUR'), '23503', 'a payment cannot be collected for another company''s order');

INSERT INTO commerce.payment (id, group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency)
VALUES ('92000000-0000-7000-8000-000000000001', :G, :O1, :E1, 'stripe', 'test', 450, 'EUR');

RESET ROLE; SELECT test.as_worker();
SELECT test.expect_error(format(
  'INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, payment_id, currency, amount_minor) VALUES (%L,%L,%L,%L,%L,%L,%L,450)',
  :G, :L1, :E1, :B, 'payment', '92000000-0000-7000-8000-000000000001', 'EUR'),
  '23503', 'revenue cannot be allocated to a school other than the order line''s');
SELECT test.expect_error(format(
  'INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, payment_id, currency, amount_minor) VALUES (%L,%L,%L,%L,%L,%L,%L,450)',
  :G, :L1, :E2, :A, 'payment', '92000000-0000-7000-8000-000000000001', 'EUR'),
  '23503', 'revenue cannot be allocated to a company other than the order line''s');
SELECT test.expect_error(format(
  'INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, payment_id, currency, amount_minor) VALUES (%L,%L,%L,%L,%L,NULL,%L,450)',
  :G, :L1, :E1, :A, 'payment', 'EUR'), '23514', 'a payment allocation must reference its payment');
SELECT test.expect_error(format(
  'INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, credit_id, currency, amount_minor) VALUES (%L,%L,%L,%L,%L,NULL,%L,-450)',
  :G, :L1, :E2, :A, 'credit_issued', 'EUR'), '23514', 'a credit allocation must reference its credit');

ROLLBACK;
