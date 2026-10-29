-- migrate:up

-- A service the group offers in general (lunch, an activity type, tuition).
CREATE TABLE catalog.service_definition (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id    uuid NOT NULL REFERENCES org.education_group (id),
  code        text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  kind        text NOT NULL CHECK (kind IN ('tuition', 'lunch', 'activity', 'lesson', 'trip', 'transport', 'uniform', 'fee', 'other')),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code),
  UNIQUE (id, group_id)
);

-- A school's own offering of a service, billed by one legal entity. Changing
-- the billing entity of an offering that has orders is refused (foreign key
-- from order lines); create a new offering instead.
CREATE TABLE catalog.school_offering (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  school_id             uuid NOT NULL,
  service_definition_id uuid NOT NULL,
  billing_entity_id     uuid NOT NULL,
  code                  text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description           text,
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  capacity_mode         text NOT NULL DEFAULT 'per_session' CHECK (capacity_mode IN ('unlimited', 'per_session')),
  eligibility           jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(eligibility) = 'object'),
  booking_opens_at      timestamptz,
  booking_closes_at     timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, code),
  UNIQUE (id, school_id),
  UNIQUE (id, billing_entity_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  FOREIGN KEY (service_definition_id, group_id) REFERENCES catalog.service_definition (id, group_id),
  FOREIGN KEY (billing_entity_id, group_id) REFERENCES org.legal_entity (id, group_id),
  CHECK (booking_closes_at IS NULL OR booking_opens_at IS NULL OR booking_closes_at > booking_opens_at)
);
CREATE INDEX school_offering_service_idx ON catalog.school_offering (service_definition_id);
CREATE INDEX school_offering_billing_entity_idx ON catalog.school_offering (billing_entity_id);
CREATE INDEX school_offering_published_idx ON catalog.school_offering (school_id) WHERE status = 'published';

-- Versioned terms (booking, cancellation and refund rules) for an offering.
CREATE TABLE catalog.policy_version (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id     uuid NOT NULL REFERENCES org.education_group (id),
  offering_id  uuid NOT NULL REFERENCES catalog.school_offering (id),
  kind         text NOT NULL CHECK (kind IN ('booking_and_cancellation', 'terms_of_sale')),
  version      integer NOT NULL CHECK (version > 0),
  rules        jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(rules) = 'object'),
  terms_text   text,
  valid_from   timestamptz NOT NULL,
  valid_until  timestamptz,
  created_by_person_id uuid REFERENCES people.person (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, kind, version),
  UNIQUE (id, offering_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  EXCLUDE USING gist (offering_id WITH =, kind WITH =, tstzrange(valid_from, valid_until, '[)') WITH &&)
);
CREATE INDEX policy_version_created_by_idx ON catalog.policy_version (created_by_person_id);

-- Immutable price versions. Closing a version (setting valid_until) is the
-- only permitted change; overlaps are rejected.
CREATE TABLE catalog.price_version (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id          uuid NOT NULL REFERENCES org.education_group (id),
  offering_id       uuid NOT NULL REFERENCES catalog.school_offering (id),
  version           integer NOT NULL CHECK (version > 0),
  label             text,
  currency          char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  unit_amount_minor bigint NOT NULL CHECK (unit_amount_minor >= 0),
  vat_rate_bp       integer NOT NULL DEFAULT 0 CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  price_unit        text NOT NULL CHECK (price_unit IN ('per_session', 'per_day', 'per_month', 'per_term', 'per_package', 'one_off')),
  package_size      integer CHECK (package_size > 0),
  valid_from        timestamptz NOT NULL,
  valid_until       timestamptz,
  created_by_person_id uuid REFERENCES people.person (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, version),
  UNIQUE (id, offering_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK ((price_unit = 'per_package') = (package_size IS NOT NULL)),
  EXCLUDE USING gist (offering_id WITH =, tstzrange(valid_from, valid_until, '[)') WITH &&)
);
CREATE INDEX price_version_created_by_idx ON catalog.price_version (created_by_person_id);
COMMENT ON COLUMN catalog.price_version.unit_amount_minor IS 'Gross unit price in minor units (cents), VAT included.';

CREATE FUNCTION catalog.protect_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '%.% rows are permanent', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'PY004';
  END IF;
  IF (to_jsonb(NEW) - 'valid_until') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_until') THEN
    RAISE EXCEPTION 'only valid_until can change on %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'PY004';
  END IF;
  IF OLD.valid_until IS NOT NULL AND OLD.valid_until <= now() THEN
    RAISE EXCEPTION 'a version that has already ended cannot change' USING ERRCODE = 'PY004';
  END IF;
  -- History is not rewritten: a version can be closed now or in the future, not in the past.
  IF NEW.valid_until IS NOT NULL AND NEW.valid_until < now() THEN
    RAISE EXCEPTION 'valid_until cannot be set in the past' USING ERRCODE = 'PY004';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_version BEFORE UPDATE OR DELETE ON catalog.price_version  FOR EACH ROW EXECUTE FUNCTION catalog.protect_version();
CREATE TRIGGER protect_version BEFORE UPDATE OR DELETE ON catalog.policy_version FOR EACH ROW EXECUTE FUNCTION catalog.protect_version();

-- ---------------------------------------------------------------------------
-- Scheduling: sessions (a lunch day, an activity meeting, a lesson slot, a trip)
-- with transactional capacity, and bookings of students onto them.
-- ---------------------------------------------------------------------------
CREATE TABLE scheduling.session (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id               uuid NOT NULL REFERENCES org.education_group (id),
  school_id              uuid NOT NULL,
  offering_id            uuid NOT NULL,
  service_date           date,
  starts_at              timestamptz,
  ends_at                timestamptz,
  location_label         text,
  capacity               integer CHECK (capacity >= 0),
  reserved_count         integer NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  confirmed_count        integer NOT NULL DEFAULT 0 CHECK (confirmed_count >= 0),
  booking_cutoff_at      timestamptz,
  cancellation_cutoff_at timestamptz,
  status                 text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  FOREIGN KEY (offering_id, school_id) REFERENCES catalog.school_offering (id, school_id),
  CONSTRAINT session_within_capacity CHECK (capacity IS NULL OR reserved_count + confirmed_count <= capacity),
  CHECK (service_date IS NOT NULL OR starts_at IS NOT NULL),
  CHECK (ends_at IS NULL OR (starts_at IS NOT NULL AND ends_at > starts_at))
);
CREATE INDEX session_offering_idx ON scheduling.session (offering_id, service_date);
CREATE INDEX session_school_date_idx ON scheduling.session (school_id, service_date);
COMMENT ON COLUMN scheduling.session.service_date IS 'Calendar date in the school''s time zone.';
COMMENT ON COLUMN scheduling.session.reserved_count IS 'Maintained by booking triggers. Never written by the application.';

CREATE TABLE scheduling.booking (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id                uuid NOT NULL,
  school_id               uuid NOT NULL,
  session_id              uuid NOT NULL,
  student_person_id       uuid NOT NULL,
  order_line_id           uuid,
  status                  text NOT NULL CHECK (status IN ('reserved', 'confirmed', 'cancelled', 'expired', 'attended', 'absent')),
  reserved_until          timestamptz,
  confirmed_at            timestamptz,
  cancelled_at            timestamptz,
  cancelled_by_person_id  uuid REFERENCES people.person (id),
  cancellation_reason     text,
  created_by_person_id    uuid REFERENCES people.person (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, school_id) REFERENCES scheduling.session (id, school_id),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (status <> 'reserved' OR reserved_until IS NOT NULL),
  CHECK (status NOT IN ('cancelled') OR cancelled_at IS NOT NULL)
);
CREATE UNIQUE INDEX booking_one_live_per_student
  ON scheduling.booking (session_id, student_person_id) WHERE status IN ('reserved', 'confirmed', 'attended', 'absent');
CREATE INDEX booking_session_idx ON scheduling.booking (session_id, status);
CREATE INDEX booking_student_idx ON scheduling.booking (student_person_id);
CREATE INDEX booking_school_idx ON scheduling.booking (school_id, status);
CREATE INDEX booking_order_line_idx ON scheduling.booking (order_line_id);
CREATE INDEX booking_expiry_idx ON scheduling.booking (reserved_until) WHERE status = 'reserved';
CREATE INDEX booking_cancelled_by_idx ON scheduling.booking (cancelled_by_person_id);
CREATE INDEX booking_created_by_idx ON scheduling.booking (created_by_person_id);

-- New bookings need a scheduled session.
CREATE FUNCTION scheduling.check_session_open() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scheduling.session s WHERE s.id = NEW.session_id AND s.status = 'scheduled') THEN
    RAISE EXCEPTION 'session % is not open for booking', NEW.session_id USING ERRCODE = 'PY007';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_session_open BEFORE INSERT ON scheduling.booking
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_session_open();

-- Keeps session counters in step with bookings, in the same transaction. The
-- session row lock serialises concurrent bookings, and the capacity check on
-- the session rejects the one that would overfill it.
CREATE FUNCTION scheduling.maintain_session_counts() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  old_reserved int := CASE WHEN TG_OP <> 'INSERT' AND OLD.status = 'reserved' THEN 1 ELSE 0 END;
  old_confirmed int := CASE WHEN TG_OP <> 'INSERT' AND OLD.status IN ('confirmed', 'attended', 'absent') THEN 1 ELSE 0 END;
  new_reserved int := CASE WHEN TG_OP <> 'DELETE' AND NEW.status = 'reserved' THEN 1 ELSE 0 END;
  new_confirmed int := CASE WHEN TG_OP <> 'DELETE' AND NEW.status IN ('confirmed', 'attended', 'absent') THEN 1 ELSE 0 END;
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.session_id ELSE NEW.session_id END;
BEGIN
  IF new_reserved - old_reserved = 0 AND new_confirmed - old_confirmed = 0 THEN
    RETURN NULL;
  END IF;
  BEGIN
    UPDATE scheduling.session
       SET reserved_count = reserved_count + new_reserved - old_reserved,
           confirmed_count = confirmed_count + new_confirmed - old_confirmed
     WHERE id = target;
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION 'session % is full', target USING ERRCODE = 'PY002';
  END;
  RETURN NULL;
END $$;
CREATE TRIGGER maintain_session_counts AFTER INSERT OR DELETE OR UPDATE OF status ON scheduling.booking
  FOR EACH ROW EXECUTE FUNCTION scheduling.maintain_session_counts();

-- Triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON catalog.service_definition FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON catalog.school_offering    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduling.session         FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduling.booking         FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON catalog.service_definition FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON catalog.school_offering    FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON catalog.policy_version     FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON catalog.price_version      FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.session         FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.booking         FOR EACH ROW EXECUTE FUNCTION audit.log_change('cancellation_reason');

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('service_definition', 'active', 'retired'),
  ('school_offering', 'draft', 'published'), ('school_offering', 'published', 'closed'),
  ('school_offering', 'closed', 'published'), ('school_offering', 'draft', 'archived'),
  ('school_offering', 'closed', 'archived'),
  ('session', 'scheduled', 'cancelled'), ('session', 'scheduled', 'completed'),
  ('booking', 'reserved', 'confirmed'), ('booking', 'reserved', 'expired'), ('booking', 'reserved', 'cancelled'),
  ('booking', 'confirmed', 'cancelled'), ('booking', 'confirmed', 'attended'), ('booking', 'confirmed', 'absent'),
  ('booking', 'attended', 'absent'), ('booking', 'absent', 'attended'),
  -- Late payment recovery: an expired reservation can be confirmed if a seat is still free.
  ('booking', 'expired', 'confirmed');

CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON catalog.service_definition FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('service_definition');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON catalog.school_offering    FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('school_offering');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON scheduling.session         FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('session');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON scheduling.booking         FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('booking');

-- migrate:down
DELETE FROM meta.state_transition WHERE machine IN ('service_definition', 'school_offering', 'session', 'booking');
DROP TABLE scheduling.booking;
DROP FUNCTION scheduling.maintain_session_counts();
DROP FUNCTION scheduling.check_session_open();
DROP TABLE scheduling.session;
DROP TABLE catalog.price_version;
DROP TABLE catalog.policy_version;
DROP FUNCTION catalog.protect_version();
DROP TABLE catalog.school_offering;
DROP TABLE catalog.service_definition;
