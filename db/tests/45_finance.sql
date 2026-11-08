-- What schools spend against their budgets, and an invoice for each paid order.
BEGIN;
\ir _fixtures.sql
\echo '# 45 expenses, budgets and invoices'

\set O1 '''0f000000-0000-7000-8000-000000000001'''
\set O2 '''0f000000-0000-7000-8000-000000000002'''

SELECT test.as_person(:FIN);
INSERT INTO finance.expense (group_id, school_id, category, description, amount_minor, spent_on, recorded_by)
VALUES (:G, :A, 'food', 'Kitchen supplies (synthetic)', 12550, '2026-10-20', :FIN);
INSERT INTO finance.budget (group_id, school_id, academic_year, category, amount_minor)
VALUES (:G, :A, '2026/2027', 'food', 500000);
SELECT test.expect_error(format(
  'INSERT INTO finance.budget (group_id, school_id, academic_year, category, amount_minor) VALUES (%L, %L, ''2026/2027'', ''food'', 1)',
  :G, :A), '23505', 'a category has one budget a year');
SELECT test.expect_error(format(
  'INSERT INTO finance.expense (group_id, school_id, category, description, amount_minor, spent_on) VALUES (%L, %L, ''food'', ''Nothing'', 0, ''2026-10-20'')',
  :G, :A), '23514', 'an expense costs something');
RESET ROLE;

SELECT test.as_person(:PRA);
SELECT test.ok((SELECT count(*) FROM finance.expense) = 1, 'a principal sees the school''s expenses');
SELECT test.expect_error(format(
  'INSERT INTO finance.expense (group_id, school_id, category, description, amount_minor, spent_on) VALUES (%L, %L, ''food'', ''Bread'', 100, ''2026-10-20'')',
  :G, :A), '42501', 'but does not record them');
RESET ROLE;

SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM finance.expense) = 0 AND (SELECT count(*) FROM finance.budget) = 0,
  'a teacher sees neither expenses nor budgets');
RESET ROLE;

SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM finance.expense) = 0, 'nor does a family');
SELECT test.ok(finance.school_income(:A, DATE '2026-01-01', DATE '2027-01-01') = 0, 'and a family learns no school''s income');
RESET ROLE;

-- Invoices: one for each paid order, numbered without gaps for each company.
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id, status, placed_at, total_minor, expires_at)
VALUES (:O1, :G, :E1, :P, 'family_portal', 'test-invoice-1', :P, 'pending_payment', now(), 6000, now() + interval '30 minutes'),
       (:O2, :G, :E1, :Q, 'family_portal', 'test-invoice-2', :Q, 'pending_payment', now(), 7000, now() + interval '30 minutes');
SELECT test.ok((SELECT count(*) FROM finance.invoice) = 0, 'an unpaid order has no invoice');
UPDATE commerce.customer_order SET status = 'paid', paid_at = now() WHERE id = :O1;
UPDATE commerce.customer_order SET status = 'paid', paid_at = now() WHERE id = :O2;
SELECT test.ok((SELECT number FROM finance.invoice WHERE order_id = :O1) = 1
           AND (SELECT number FROM finance.invoice WHERE order_id = :O2) = 2, 'paid orders are numbered in turn');
SELECT test.ok((SELECT total_minor FROM finance.invoice WHERE order_id = :O2) = 7000, 'an invoice carries the order''s total');

SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM finance.invoice) = 1, 'a family sees only its own invoices');
RESET ROLE;

SELECT test.as_person(:FIN);
SELECT test.ok((SELECT count(*) FROM finance.invoice) = 2, 'group finance sees them all');
RESET ROLE;

ROLLBACK;
