-- Payment states, verified webhook events, duplicates, out-of-order events,
-- failed payments, expiry and late payment recovery.
BEGIN;
\ir _fixtures.sql
\echo '# 07 payments and provider events'
\set O1  '''90000000-0000-7000-8000-000000000001'''
\set O2  '''90000000-0000-7000-8000-000000000002'''
\set L1  '''91000000-0000-7000-8000-000000000001'''
\set L2  '''91000000-0000-7000-8000-000000000002'''
\set PAY1 '''92000000-0000-7000-8000-000000000001'''
\set PAY2 '''92000000-0000-7000-8000-000000000002'''
\set BK1 '''a1000000-0000-7000-8000-000000000001'''
\set BK2 '''a1000000-0000-7000-8000-000000000002'''

-- Parent P builds and places an order, reserving the seat in the same transaction.
RESET ROLE; SELECT test.as_person(:P);
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O1, :G, :E1, :P, 'family_portal', 'test-idem-0101', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:L1, :G, :O1, :E1, 1, :A, :CHA, :SCHA, :K1, :PCHA1, 'Chess club, autumn term', 1, 'EUR', 6000, 0, 6000);
INSERT INTO scheduling.booking (id, group_id, school_id, session_id, student_person_id, order_line_id, status, reserved_until, created_by_person_id)
VALUES (:BK1, :G, :A, :SCHA, :K1, :L1, 'reserved', now() + interval '30 minutes', :P);
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 6000, expires_at = now() + interval '30 minutes'
 WHERE id = :O1;
INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
VALUES (:G, 'commerce.order', :O1, 'commerce.order.placed', jsonb_build_object('order_id', :O1));
INSERT INTO commerce.payment (id, group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency)
VALUES (:PAY1, :G, :O1, :E1, 'stripe', 'test', 6000, 'EUR');
UPDATE commerce.payment SET status = 'pending', provider_checkout_id = 'cs_test_synthetic_1' WHERE id = :PAY1;
SELECT test.ok(true, 'the API places the order, reserves capacity, writes the outbox event and starts checkout');

SELECT test.expect_error(format('UPDATE commerce.payment SET status = %L WHERE id = %L', 'succeeded', :PAY1),
  '42501', 'the API cannot mark a payment succeeded (a browser success page proves nothing)');
SELECT test.expect_error(format('UPDATE commerce.customer_order SET status = %L WHERE id = %L', 'paid', :O1),
  '42501', 'the API cannot mark an order paid');
SELECT test.expect_error('SELECT count(*) FROM integration.outbox_event', '42501', 'the API cannot read the outbox');

-- The provider webhook arrives without a signed-in person.
RESET ROLE; SELECT test.as_anonymous();
INSERT INTO integration.inbound_event (provider, provider_mode, provider_event_id, event_type, provider_created_at, signature_verified, payload)
VALUES ('stripe', 'test', 'evt_synthetic_1', 'checkout.session.completed', now(), true, '{"id": "evt_synthetic_1"}');
INSERT INTO integration.inbound_event (provider, provider_mode, provider_event_id, event_type, provider_created_at, signature_verified, payload)
VALUES ('stripe', 'test', 'evt_synthetic_1', 'checkout.session.completed', now(), true, '{"id": "evt_synthetic_1"}')
ON CONFLICT DO NOTHING;
SELECT test.expect_error(
  'INSERT INTO integration.inbound_event (provider, provider_mode, provider_event_id, event_type, provider_created_at, signature_verified, payload) VALUES (''stripe'', ''test'', ''evt_forged'', ''checkout.session.completed'', now(), false, ''{}'')',
  '23514', 'an event whose signature was not verified cannot be stored');
SELECT test.expect_error('SELECT count(*) FROM integration.inbound_event', '42501', 'the API cannot read stored provider events');

RESET ROLE; SELECT test.as_worker();
SELECT test.ok((SELECT count(*) FROM integration.inbound_event WHERE provider_event_id = 'evt_synthetic_1') = 1,
  'a duplicate delivery of the same provider event is stored once');

-- The worker confirms everything in one transaction.
UPDATE commerce.payment SET status = 'succeeded', succeeded_at = now(), provider_payment_id = 'pi_synthetic_1',
       provider_status = 'paid', provider_status_at = now() WHERE id = :PAY1;
UPDATE commerce.customer_order SET status = 'paid', paid_at = now() WHERE id = :O1;
UPDATE commerce.order_line SET status = 'confirmed' WHERE id = :L1;
UPDATE scheduling.booking SET status = 'confirmed', confirmed_at = now() WHERE id = :BK1;
INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, payment_id, currency, amount_minor)
VALUES (:G, :L1, :E1, :A, 'payment', :PAY1, 'EUR', 6000);
UPDATE integration.inbound_event SET processing_status = 'processed', processed_at = now() WHERE provider_event_id = 'evt_synthetic_1';
INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
VALUES (:G, 'commerce.order', :O1, 'commerce.order.paid', jsonb_build_object('order_id', :O1));
RESET ROLE;
SELECT test.ok((SELECT confirmed_count FROM scheduling.session WHERE id = :SCHA) = 1
           AND (SELECT reserved_count FROM scheduling.session WHERE id = :SCHA) = 0,
  'confirmation moves the seat from reserved to confirmed');

-- An older provider event arriving late cannot move the payment backwards.
SELECT test.as_worker();
SELECT test.expect_error(format('UPDATE commerce.payment SET status = %L WHERE id = %L', 'processing', :PAY1),
  'PY001', 'an out-of-order event cannot move a succeeded payment back');
SELECT test.expect_error(format('UPDATE commerce.customer_order SET status = %L WHERE id = %L', 'pending_payment', :O1),
  'PY001', 'a paid order cannot return to pending payment');

-- A second order whose payment fails and whose reservation expires.
RESET ROLE; SELECT test.as_person(:P);
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:O2, :G, :E1, :P, 'family_portal', 'test-idem-0102', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
                                 price_version_id, description, service_date, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:L2, :G, :O2, :E1, 1, :A, :LA, :SLA, :K1, :PLA1, 'Lunch, 2 Nov', '2026-11-02', 1, 'EUR', 450, 0, 450);
INSERT INTO scheduling.booking (id, group_id, school_id, session_id, student_person_id, order_line_id, status, reserved_until, created_by_person_id)
VALUES (:BK2, :G, :A, :SLA, :K1, :L2, 'reserved', now() + interval '30 minutes', :P);
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 450, expires_at = now() + interval '30 minutes'
 WHERE id = :O2;
INSERT INTO commerce.payment (id, group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency)
VALUES (:PAY2, :G, :O2, :E1, 'stripe', 'test', 450, 'EUR');

RESET ROLE; SELECT test.as_worker();
UPDATE commerce.payment SET status = 'failed', failure_code = 'card_declined', provider_status_at = now() WHERE id = :PAY2;
SELECT test.ok((SELECT status FROM commerce.customer_order WHERE id = :O2) = 'pending_payment',
  'a failed payment leaves the order open for another attempt');
UPDATE commerce.customer_order SET status = 'expired' WHERE id = :O2;
UPDATE scheduling.booking SET status = 'expired' WHERE id = :BK2;
RESET ROLE;
SELECT test.ok((SELECT reserved_count FROM scheduling.session WHERE id = :SLA) = 0,
  'expiry of an unpaid order releases its reservation');

-- Late payment recovery: the provider confirms after expiry and the seat is still free.
SELECT test.as_worker();
UPDATE commerce.customer_order SET status = 'paid', paid_at = now() WHERE id = :O2;
UPDATE scheduling.booking SET status = 'confirmed', confirmed_at = now() WHERE id = :BK2;
SELECT test.ok((SELECT status FROM commerce.customer_order WHERE id = :O2) = 'paid',
  'a late payment can still complete an expired order when capacity allows');
SELECT test.expect_error(format('UPDATE commerce.payment SET status = %L WHERE id = %L', 'succeeded', :PAY2),
  'PY001', 'a failed payment attempt can never become succeeded (a new attempt is a new payment)');

ROLLBACK;
