-- migrate:up

-- Verified domains are checked again every day (ADR 0018). When the
-- ownership record disappears, the domain keeps working for a grace period,
-- so a DNS hiccup or a change of DNS provider does not take a website down;
-- after that it stops being routed until the record is back.
ALTER TABLE org.website_domain ADD COLUMN missing_since timestamptz;
COMMENT ON COLUMN org.website_domain.missing_since IS
  'When a re-check of a verified domain first failed to find its DNS record; cleared when it is found again.';
GRANT UPDATE (missing_since) ON org.website_domain TO pyth_worker;
GRANT UPDATE (missing_since) ON org.website_domain TO pyth_api;

-- migrate:down
REVOKE UPDATE (missing_since) ON org.website_domain FROM pyth_api;
REVOKE UPDATE (missing_since) ON org.website_domain FROM pyth_worker;
ALTER TABLE org.website_domain DROP COLUMN missing_since;
