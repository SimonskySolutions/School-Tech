-- Cancellation, credits and refunds. A lunch cancellation adjusts only the lunch.
BEGIN;
\ir _fixtures.sql
\echo '# 09 cancellation, credits and refunds'
\set O1   '''90000000-0000-7000-8000-000000000001'''
\set O2   '''90000000-0000-7000-8000-000000000002'''
\set O3   '''90000000-0000-7000-8000-000000000003'''
\set LL   '''91000000-0000-7000-8000-000000000001'''
\set LCH  '''91000000-0000-7000-8000-000000000002'''
\set PAY1 '''92000000-0000-7000-8000-000000000001'''
\set CR1  '''93000000-0000-7000-8000-000000000001'''
\set RF1  '''94000000-0000-7000-8000-000000000001'''
\set BKL  '''a1000000-0000-7000-8000-000000000001'''
\set BKC  '''a1000000-0000-7000-8000-000000000002'''

-- A paid order: lunch (4.50) and chess (60.00) for K1 at School A.
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O1, :G, :E1, :P, 'family_portal', 'test-idem-0301', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor) VALUES
  (:LL,  :G, :O1, :E1, 1, :A, :LA,  :SLA,  :K1, :PLA1,  'Lunch, 2 Nov', 1, 'EUR', 450, 0, 450),
  (:LCH, :G, :O1, :E1, 2, :A, :CHA, :SCHA, :K1, :PCHA1, 'Chess club',   1, 'EUR', 6000, 0, 6000);
INSERT INTO scheduling.booking (id, group_id, school_id, session_id, student_person_id, order_line_id, status, confirmed_at) VALUES
  (:BKL, :G, :A, :SLA,  :K1, :LL,  'confirmed', now()),
  (:BKC, :G, :A, :SCHA, :K1, :LCH, 'confirmed', now());
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 6450 WHERE id = :O1;
INSERT INTO commerce.payment (id, group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency, status, succeeded_at)
VALUES (:PAY1, :G, :O1, :E1, 'stripe', 'test', 6450, 'EUR', 'succeeded', now());
UPDATE commerce.customer_order SET status = 'paid', paid_at = now() WHERE id = :O1;
UPDATE commerce.order_line SET status = 'confirmed' WHERE order_id = :O1;
INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, payment_id, currency, amount_minor) VALUES
  (:G, :LL,  :E1, :A, 'payment', :PAY1, 'EUR', 450),
  (:G, :LCH, :E1, :A, 'payment', :PAY1, 'EUR', 6000);

-- School Life cancels the lunch (an authorised cancellation).
SELECT test.as_person(:SL);
UPDATE scheduling.booking SET status = 'cancelled', cancelled_at = now(), cancelled_by_person_id = :SL,
       cancellation_reason = 'Absent on 2 Nov' WHERE id = :BKL;
UPDATE commerce.order_line SET status = 'cancelled' WHERE id = :LL;
RESET ROLE;
SELECT test.ok((SELECT status FROM people.enrolment WHERE student_person_id = :K1) = 'active',
  'cancelling lunch leaves the school enrolment untouched');
SELECT test.ok((SELECT status FROM scheduling.booking WHERE id = :BKC) = 'confirmed'
           AND (SELECT status FROM commerce.order_line WHERE id = :LCH) = 'confirmed',
  'cancelling lunch leaves the chess booking and its order line untouched');
SELECT test.ok((SELECT confirmed_count FROM scheduling.session WHERE id = :SLA) = 0,
  'the cancelled lunch no longer counts towards the kitchen');

-- The worker turns the cancelled lunch into account credit with company E1.
SELECT test.as_worker();
INSERT INTO commerce.account_credit (id, group_id, billing_entity_id, holder_person_id, original_amount_minor, remaining_amount_minor,
                                     reason, source_order_line_id)
VALUES (:CR1, :G, :E1, :P, 450, 450, 'Lunch cancelled for 2 Nov', :LL);
INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, credit_id, currency, amount_minor)
VALUES (:G, :LL, :E1, :A, 'credit_issued', :CR1, 'EUR', -450);
SELECT test.expect_error(format('UPDATE commerce.payment_allocation SET amount_minor = 1 WHERE credit_id = %L', :CR1),
  '42501', 'the worker cannot rewrite the financial ledger');
RESET ROLE;
SELECT test.expect_error(format('DELETE FROM commerce.payment_allocation WHERE credit_id = %L', :CR1),
  'PY004', 'the financial ledger is append-only, even for the owner');

RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT net_minor FROM reporting.school_revenue_daily WHERE school_id = :A) = 6000,
  'School A revenue is 64.50 received minus 4.50 credited');

-- Refunds: requested by finance, approved by someone else, never above the payment.
RESET ROLE; SELECT test.as_person(:FIN);
INSERT INTO commerce.refund (id, group_id, payment_id, billing_entity_id, order_line_id, amount_minor, currency, method, reason, requested_by_person_id)
VALUES (:RF1, :G, :PAY1, :E1, :LCH, 2000, 'EUR', 'original_payment', 'Chess club shortened', :FIN);
UPDATE commerce.refund SET status = 'approved', approved_by_person_id = :FIN, approved_at = now() WHERE id = :RF1;
RESET ROLE;
SELECT test.ok((SELECT status FROM commerce.refund WHERE id = :RF1) = 'requested', 'the requester cannot approve their own refund');
SELECT test.as_person(:CEO);
UPDATE commerce.refund SET status = 'approved', approved_by_person_id = :CEO, approved_at = now() WHERE id = :RF1;
RESET ROLE;
SELECT test.ok((SELECT status FROM commerce.refund WHERE id = :RF1) = 'approved', 'a second person approves the refund');
SELECT test.as_person(:FIN);
SELECT test.expect_error(format(
  'INSERT INTO commerce.refund (group_id, payment_id, billing_entity_id, amount_minor, currency, method, reason, requested_by_person_id) VALUES (%L,%L,%L,5000,%L,%L,%L,%L)',
  :G, :PAY1, :E1, 'EUR', 'original_payment', 'Too much', :FIN), 'PY010', 'refunds can never exceed the payment');

RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error(format(
  'INSERT INTO commerce.refund (group_id, payment_id, billing_entity_id, amount_minor, currency, method, reason, requested_by_person_id) VALUES (%L,%L,%L,100,%L,%L,%L,%L)',
  :G, :PAY1, :E1, 'EUR', 'account_credit', 'Goodwill', :TEAB), '42501', 'staff of another school cannot request a refund on this payment');

-- Parent P uses the credit on a new order with the same company, once.
RESET ROLE; SELECT test.as_person(:P);
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O2, :G, :E1, :P, 'family_portal', 'test-idem-0302', :P);
INSERT INTO commerce.credit_application (group_id, credit_id, order_id, billing_entity_id, amount_minor) VALUES (:G, :CR1, :O2, :E1, 450);
RESET ROLE;
SELECT test.ok((SELECT remaining_amount_minor = 0 AND status = 'used' FROM commerce.account_credit WHERE id = :CR1),
  'applying credit reduces the balance and marks it used');
SELECT test.as_person(:P);
SELECT test.expect_error(format('INSERT INTO commerce.credit_application (group_id, credit_id, order_id, billing_entity_id, amount_minor) VALUES (%L,%L,%L,%L,1)',
  :G, :CR1, :O2, :E1), 'PY009', 'used credit cannot be applied again');
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O3, :G, :E2, :P, 'family_portal', 'test-idem-0303', :P);
SELECT test.expect_error(format('INSERT INTO commerce.credit_application (group_id, credit_id, order_id, billing_entity_id, amount_minor) VALUES (%L,%L,%L,%L,1)',
  :G, :CR1, :O3, :E2), '23503', 'credit owed by one company cannot pay another company''s order');

ROLLBACK;
