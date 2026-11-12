-- migrate:up

-- The labelled development payment provider (ADR 0010). It moves no money and
-- the API refuses to run it in production; the database records which provider
-- handled each payment and event so development payments can never be mistaken
-- for real ones in reports.
ALTER TABLE commerce.payment DROP CONSTRAINT payment_provider_check;
ALTER TABLE commerce.payment ADD CONSTRAINT payment_provider_check
  CHECK (provider IN ('stripe', 'development', 'bank_transfer', 'cash_desk'));
ALTER TABLE commerce.payment ADD CONSTRAINT payment_development_is_test
  CHECK (provider <> 'development' OR provider_mode = 'test');

ALTER TABLE integration.inbound_event DROP CONSTRAINT inbound_event_provider_check;
ALTER TABLE integration.inbound_event ADD CONSTRAINT inbound_event_provider_check
  CHECK (provider IN ('stripe', 'development', 'shkolo', 'accounting', 'esignature', 'identity'));

-- The worker processes stored events oldest first.
CREATE INDEX inbound_event_received_idx ON integration.inbound_event (provider_created_at) WHERE processing_status = 'received';

-- migrate:down
DROP INDEX integration.inbound_event_received_idx;
DELETE FROM integration.inbound_event WHERE provider = 'development';
ALTER TABLE integration.inbound_event DROP CONSTRAINT inbound_event_provider_check;
ALTER TABLE integration.inbound_event ADD CONSTRAINT inbound_event_provider_check
  CHECK (provider IN ('stripe', 'shkolo', 'accounting', 'esignature', 'identity'));
ALTER TABLE commerce.payment DROP CONSTRAINT payment_development_is_test;
ALTER TABLE commerce.payment DROP CONSTRAINT payment_provider_check;
ALTER TABLE commerce.payment ADD CONSTRAINT payment_provider_check
  CHECK (provider IN ('stripe', 'bank_transfer', 'cash_desk'));
