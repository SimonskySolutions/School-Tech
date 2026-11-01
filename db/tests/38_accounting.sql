-- Accounting export (M7.4).
BEGIN;
\ir _fixtures.sql
\echo '# 38 accounting export'
\set O1 '''38000000-0000-7000-8000-000000000001'''
\set L1 '''38000000-0000-7000-8000-000000000011'''
\set PAY1 '''38000000-0000-7000-8000-000000000021'''

-- A paid chess club at School A (company E1), part of it refunded.
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O1, :G, :E1, :P, 'family_portal', 'test-idem-3801', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:L1, :G, :O1, :E1, 1, :A, :CHA, :SCHA, :K1, :PCHA1, 'Chess club, autumn term', 1, 'EUR', 6000, 0, 6000);
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 6000,
       expires_at = now() + interval '30 minutes' WHERE id = :O1;
UPDATE commerce.customer_order SET status = 'paid', paid_at = now() WHERE id = :O1;
INSERT INTO commerce.payment (id, group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency, status,
                              provider_payment_id, succeeded_at)
VALUES (:PAY1, :G, :O1, :E1, 'stripe', 'live', 6000, 'EUR', 'succeeded', 'pi_synthetic_38', now());
INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, payment_id, currency, amount_minor)
VALUES (:G, :L1, :E1, :A, 'payment', :PAY1, 'EUR', 6000);
INSERT INTO commerce.refund (id, group_id, payment_id, billing_entity_id, order_line_id, amount_minor, currency, method, status, reason,
                            approved_by_person_id, approved_at)
VALUES ('38000000-0000-7000-8000-000000000031', :G, :PAY1, :E1, :L1, 1500, 'EUR', 'original_payment', 'succeeded', 'Two sessions missed (synthetic)',
        :FIN, now());
INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, refund_id, currency, amount_minor)
VALUES (:G, :L1, :E1, :A, 'refund', '38000000-0000-7000-8000-000000000031', 'EUR', -1500);

-- Group finance exports the company's ledger, entry by entry.
SELECT test.as_person(:FIN);
SELECT test.ok((SELECT array_agg(entry || ':' || amount_minor ORDER BY amount_minor DESC)
                  FROM commerce.accounting_entries(:E1, current_date - 1, current_date)) = ARRAY['payment:6000', 'refund:-1500'],
  'the payment and the refund, signed as in the ledger');
SELECT test.ok((SELECT bool_and(order_number LIKE 'PY-%' AND school_code = 'school-a' AND service_code = 'chess'
                                AND description = 'Chess club, autumn term' AND payment_mode = 'live'
                                AND payment_provider = 'stripe' AND payment_reference = 'pi_synthetic_38')
                  FROM commerce.accounting_entries(:E1, current_date - 1, current_date)),
  'each with its order, school, service, mode and the payment it reconciles with');
SELECT test.ok((SELECT sum(amount_minor) FROM commerce.accounting_entries(:E1, current_date, current_date))
               = (SELECT sum(net_minor) FROM reporting.school_revenue_daily WHERE billing_entity_id = :E1 AND local_date = current_date),
  'the entries add up to the revenue report''s net for the same company and day');
SELECT test.ok((SELECT count(*) FROM commerce.accounting_entries(:E2, current_date - 1, current_date)) = 0,
  'another company''s export has none of it');
SELECT test.ok((SELECT count(*) FROM commerce.accounting_entries(:E1, current_date + 1, current_date + 30)) = 0,
  'nor does another period');
SELECT test.expect_error(format('SELECT count(*) FROM commerce.accounting_entries(%L, current_date - 400, current_date)', :E1),
  '22023', 'a period of a year at most');
SELECT test.expect_error(format('SELECT count(*) FROM commerce.accounting_entries(%L, current_date, current_date - 1)', :E1),
  '22023', 'that ends after it starts');
SELECT test.expect_error('SELECT count(*) FROM commerce.accounting_entries(gen_random_uuid(), current_date, current_date)',
  'P0002', 'for a company of the group');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM information_schema.parameters
                            WHERE specific_schema = 'commerce' AND specific_name LIKE 'accounting_entries%'
                              AND parameter_name ~ 'payer|name$|email|student'
                              AND parameter_name <> 'school_name'),
  'no payer, student or e-mail in it');
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM audit.access_log WHERE actor_person_id = :FIN AND action = 'export'
                  AND resource = 'commerce.accounting_entries') >= 5,
  'every export is in the access log, with how many entries');

-- Finance only.
SELECT test.as_person(:CEO);
SELECT test.expect_error(format('SELECT count(*) FROM commerce.accounting_entries(%L, current_date, current_date)', :E1),
  '42501', 'not the CEO');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.expect_error(format('SELECT count(*) FROM commerce.accounting_entries(%L, current_date, current_date)', :E1),
  '42501', 'not a principal');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT count(*) FROM commerce.accounting_entries(%L, current_date, current_date)', :E1),
  '42501', 'nor a parent');
RESET ROLE;

ROLLBACK;
