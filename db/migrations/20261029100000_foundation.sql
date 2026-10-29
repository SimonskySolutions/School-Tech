-- migrate:up

-- Schemas by business capability. Each module owns its schema; other modules
-- use its tables only through the grants and functions defined here.
CREATE SCHEMA app;          -- request context and generic helpers
CREATE SCHEMA audit;        -- change and access logs
CREATE SCHEMA org;          -- education group, legal entities, schools, websites, domains
CREATE SCHEMA people;       -- persons, login identities, guardians, enrolments
CREATE SCHEMA access;       -- roles, permissions, assignments, authorization helpers
CREATE SCHEMA catalog;      -- service definitions, school offerings, prices, policies
CREATE SCHEMA scheduling;   -- sessions, capacity, bookings
CREATE SCHEMA commerce;     -- orders, payments, allocations, credits, refunds
CREATE SCHEMA integration;  -- outbox, inbound provider events, external references
CREATE SCHEMA privacy;      -- GDPR records: purposes, retention, consent, subject requests
CREATE SCHEMA sensitive;    -- special-category data (health, diet), segregated
CREATE SCHEMA reporting;    -- read models for owner and school reporting

COMMENT ON SCHEMA sensitive IS 'Special-category personal data (GDPR Art. 9). Access requires a dedicated permission; reads are logged by the API.';

REVOKE ALL ON SCHEMA app, audit, org, people, access, catalog, scheduling, commerce, integration, privacy, sensitive, reporting FROM PUBLIC;
GRANT USAGE ON SCHEMA app, audit, org, people, access, catalog, scheduling, commerce, integration, privacy, sensitive, reporting
  TO pyth_api, pyth_worker;

-- No function is executable by PUBLIC unless granted explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE pyth_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Request context. The API sets these with SET LOCAL at the start of every
-- transaction, from the verified identity-provider token (ADR 0005).
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.current_person_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT nullif(current_setting('app.person_id', true), '')::uuid $$;

CREATE FUNCTION app.current_request_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT nullif(current_setting('app.request_id', true), '') $$;

CREATE FUNCTION app.current_actor() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT nullif(current_setting('app.actor', true), '') $$;

GRANT EXECUTE ON FUNCTION app.current_person_id(), app.current_request_id(), app.current_actor()
  TO pyth_api, pyth_worker;

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
CREATE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Validates an IANA time zone held in the column named by TG_ARGV[0].
CREATE FUNCTION app.check_time_zone() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  tz text := to_jsonb(NEW) ->> TG_ARGV[0];
BEGIN
  IF tz IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = tz) THEN
    RAISE EXCEPTION 'unknown time zone: %', tz USING ERRCODE = 'PY005';
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- State machines. Allowed transitions are data; a trigger rejects any other
-- change of the status column (ADR 0007).
-- ---------------------------------------------------------------------------
CREATE TABLE meta.state_transition (
  machine    text NOT NULL,
  from_state text NOT NULL,
  to_state   text NOT NULL,
  PRIMARY KEY (machine, from_state, to_state),
  CHECK (from_state <> to_state)
);
COMMENT ON TABLE meta.state_transition IS 'Allowed status transitions per state machine, enforced by app.enforce_transition().';

CREATE FUNCTION app.enforce_transition() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
    SELECT 1 FROM meta.state_transition t
    WHERE t.machine = TG_ARGV[0] AND t.from_state = OLD.status AND t.to_state = NEW.status
  ) THEN
    RAISE EXCEPTION '% cannot move from % to %', TG_ARGV[0], OLD.status, NEW.status
      USING ERRCODE = 'PY001';
  END IF;
  RETURN NEW;
END $$;

-- migrate:down
DROP FUNCTION app.enforce_transition();
DROP TABLE meta.state_transition;
DROP FUNCTION app.check_time_zone();
DROP FUNCTION app.set_updated_at();
DROP FUNCTION app.current_actor();
DROP FUNCTION app.current_request_id();
DROP FUNCTION app.current_person_id();
ALTER DEFAULT PRIVILEGES FOR ROLE pyth_owner GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
DROP SCHEMA reporting, sensitive, privacy, integration, commerce, scheduling, catalog, access, people, org, audit, app;
