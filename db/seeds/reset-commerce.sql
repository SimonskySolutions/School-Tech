-- DEVELOPMENT ONLY - removes every order, booking, payment, credit and provider
-- event so purchase tests start from the seeded catalogue. Refuses to run when
-- the database holds anyone without a reserved .test address (that is, real
-- people). Needs a superuser: the ledger is append-only, so its triggers are
-- switched off for this one transaction, and session counters are reset.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'pythagoras'
     OR EXISTS (SELECT 1 FROM people.person WHERE email IS NOT NULL AND email NOT LIKE '%@pythagoras.test') THEN
    RAISE EXCEPTION 'reset-commerce: this is not the synthetic development database';
  END IF;
END $$;
SET LOCAL session_replication_role = replica;
DELETE FROM commerce.payment_allocation;
DELETE FROM commerce.credit_application;
DELETE FROM commerce.refund;
DELETE FROM commerce.account_credit;
DELETE FROM scheduling.booking;
DELETE FROM commerce.payment;
DELETE FROM commerce.order_line;
DELETE FROM commerce.customer_order;
DELETE FROM integration.inbound_event WHERE provider IN ('development', 'stripe');
DELETE FROM integration.outbox_event WHERE aggregate_type = 'commerce.order';
UPDATE scheduling.session SET reserved_count = 0, confirmed_count = 0 WHERE reserved_count <> 0 OR confirmed_count <> 0;
COMMIT;
