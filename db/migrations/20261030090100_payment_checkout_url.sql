-- migrate:up

-- The provider's hosted checkout page for a payment, kept while the order is
-- unpaid so a parent who closed the tab can come back and pay (ADR 0010). The
-- URL identifies a checkout session only; it holds no card or personal data.
ALTER TABLE commerce.payment ADD COLUMN checkout_url text
  CONSTRAINT payment_checkout_url_check CHECK (checkout_url ~ '^https?://[^\s]+$' AND length(checkout_url) <= 2048);
COMMENT ON COLUMN commerce.payment.checkout_url IS 'Hosted checkout page of the provider; shown to the payer only while the order awaits payment.';
GRANT UPDATE (checkout_url) ON commerce.payment TO pyth_api;

-- migrate:down
REVOKE UPDATE (checkout_url) ON commerce.payment FROM pyth_api;
ALTER TABLE commerce.payment DROP COLUMN checkout_url;
