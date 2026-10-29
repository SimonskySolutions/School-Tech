-- School-level revenue and outstanding balances, scoped by the reader's access.
BEGIN;
\ir _fixtures.sql
\echo '# 10 reporting'
\set OA '''90000000-0000-7000-8000-00000000000a'''
\set OC '''90000000-0000-7000-8000-00000000000c'''
\set OT '''90000000-0000-7000-8000-0000000000aa'''
\set LA1 '''91000000-0000-7000-8000-00000000000a'''
\set LC1 '''91000000-0000-7000-8000-00000000000c'''

-- Paid lunch at School A (E1) and Kindergarten C (E2).
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id) VALUES
  (:OA, :G, :E1, :P, 'family_portal', 'test-idem-0401', :P),
  (:OC, :G, :E2, :P, 'family_portal', 'test-idem-0402', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor) VALUES
  (:LA1, :G, :OA, :E1, 1, :A, :LA, :K1, :PLA1, 'Lunch x5', 5, 'EUR', 450, 0, 2250),
  (:LC1, :G, :OC, :E2, 1, :C, :LC, :K2, :PLC1, 'Lunch x5', 5, 'EUR', 500, 0, 2500);
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 2250 WHERE id = :OA;
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 2500 WHERE id = :OC;
INSERT INTO commerce.payment (id, group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency, status, succeeded_at) VALUES
  ('92000000-0000-7000-8000-00000000000a', :G, :OA, :E1, 'stripe', 'test', 2250, 'EUR', 'succeeded', now()),
  ('92000000-0000-7000-8000-00000000000c', :G, :OC, :E2, 'stripe', 'test', 2500, 'EUR', 'succeeded', now());
UPDATE commerce.customer_order SET status = 'paid', paid_at = now() WHERE id IN (:OA, :OC);
INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, payment_id, currency, amount_minor) VALUES
  (:G, :LA1, :E1, :A, 'payment', '92000000-0000-7000-8000-00000000000a', 'EUR', 2250),
  (:G, :LC1, :E2, :C, 'payment', '92000000-0000-7000-8000-00000000000c', 'EUR', 2500);

-- Finance issues a tuition invoice at School A, already overdue.
SELECT test.as_person(:FIN);
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id, due_date)
VALUES (:OT, :G, :E1, :P, 'staff_invoice', 'test-idem-0403', :FIN, current_date - 5);
INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:G, :OT, :E1, 1, :A, :TA, :K1, :PTA1, 'Tuition, October', 1, 'EUR', 45000, 0, 45000);
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 45000 WHERE id = :OT;
SELECT test.ok(true, 'group finance issues a tuition invoice to a parent');

RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT received_minor FROM reporting.school_revenue_daily WHERE school_id = :A) = 2250
           AND (SELECT received_minor FROM reporting.school_revenue_daily WHERE school_id = :C) = 2500,
  'the CEO sees revenue per school across companies (A 22.50, C 25.00)');
SELECT test.ok((SELECT outstanding_minor FROM reporting.outstanding_balance WHERE school_id = :A) = 45000
           AND (SELECT overdue_minor FROM reporting.outstanding_balance WHERE school_id = :A) = 45000,
  'the CEO sees School A''s outstanding and overdue tuition');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM reporting.outstanding_balance WHERE school_id = :C AND outstanding_minor > 0),
  'Kindergarten C has nothing outstanding');

RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT array_agg(DISTINCT school_id) FROM reporting.school_revenue_daily) = ARRAY[:A]::uuid[],
  'the principal of School A sees only School A revenue');
SELECT test.ok((SELECT count(*) FROM reporting.outstanding_balance WHERE school_id <> :A) = 0,
  'the principal of School A sees only School A balances');

RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM reporting.school_revenue_daily) = 0, 'a teacher sees no financial reports');

ROLLBACK;
