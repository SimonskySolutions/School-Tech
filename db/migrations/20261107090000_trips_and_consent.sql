-- migrate:up

-- Trips and guardian consent (M4.4, ADR 0023). A trip is an offering of kind
-- "trip" with one session. Its consent wording is a versioned policy text, a
-- guardian's permission points at the exact version agreed to, no booking is
-- possible without it, and withdrawing it before the trip cancels the place
-- (with credit of what was paid).

ALTER TABLE catalog.policy_version DROP CONSTRAINT policy_version_kind_check;
ALTER TABLE catalog.policy_version
  ADD CONSTRAINT policy_version_kind_check CHECK (kind IN ('booking_and_cancellation', 'terms_of_sale', 'trip_consent')),
  ADD CONSTRAINT policy_version_consent_wording CHECK (kind <> 'trip_consent' OR length(terms_text) BETWEEN 10 AND 5000);

-- The trip consent wording in force now for an offering, or NULL.
CREATE FUNCTION catalog.current_trip_consent(p_offering_id uuid) RETURNS uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT id FROM catalog.policy_version
   WHERE offering_id = p_offering_id AND kind = 'trip_consent'
     AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())
   ORDER BY valid_from DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION catalog.current_trip_consent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION catalog.current_trip_consent(uuid) TO pyth_api;

CREATE TABLE scheduling.trip_permission (
  id                       uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id                 uuid NOT NULL,
  school_id                uuid NOT NULL,
  session_id               uuid NOT NULL,
  student_person_id        uuid NOT NULL,
  policy_version_id        uuid NOT NULL REFERENCES catalog.policy_version (id),
  given_by_person_id       uuid NOT NULL,
  channel                  text NOT NULL CHECK (channel IN ('family_portal', 'paper', 'in_person')),
  recorded_by_person_id    uuid REFERENCES people.person (id),
  emergency_contact_name   text NOT NULL CHECK (length(emergency_contact_name) BETWEEN 1 AND 120),
  emergency_contact_phone  text NOT NULL CHECK (emergency_contact_phone ~ '^\+?[0-9 ()-]{6,25}$'),
  status                   text NOT NULL DEFAULT 'given' CHECK (status IN ('given', 'withdrawn')),
  given_at                 timestamptz NOT NULL DEFAULT now(),
  withdrawn_at             timestamptz,
  withdrawn_by_person_id   uuid REFERENCES people.person (id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, school_id) REFERENCES scheduling.session (id, school_id),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (given_by_person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (status <> 'withdrawn' OR (withdrawn_at IS NOT NULL AND withdrawn_by_person_id IS NOT NULL)),
  CHECK ((channel = 'family_portal') = (recorded_by_person_id IS NULL))
);
CREATE UNIQUE INDEX trip_permission_one_live ON scheduling.trip_permission (session_id, student_person_id) WHERE status = 'given';
CREATE INDEX trip_permission_session_idx ON scheduling.trip_permission (session_id);
CREATE INDEX trip_permission_student_idx ON scheduling.trip_permission (student_person_id);
CREATE INDEX trip_permission_policy_idx ON scheduling.trip_permission (policy_version_id);
CREATE INDEX trip_permission_given_by_idx ON scheduling.trip_permission (given_by_person_id);
CREATE INDEX trip_permission_recorded_by_idx ON scheduling.trip_permission (recorded_by_person_id);
CREATE INDEX trip_permission_withdrawn_by_idx ON scheduling.trip_permission (withdrawn_by_person_id);

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES ('trip_permission', 'given', 'withdrawn');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON scheduling.trip_permission
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('trip_permission');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduling.trip_permission FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.trip_permission
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('emergency_contact_name', 'emergency_contact_phone');

-- A permission is for a trip that has not started, to its wording in force
-- now, from someone who may consent for the child.
CREATE FUNCTION scheduling.check_trip_permission() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  s record;
BEGIN
  SELECT x.offering_id, x.starts_at, x.status, d.kind INTO s
    FROM scheduling.session x
    JOIN catalog.school_offering o ON o.id = x.offering_id
    JOIN catalog.service_definition d ON d.id = o.service_definition_id
   WHERE x.id = NEW.session_id;
  IF s.kind IS DISTINCT FROM 'trip' THEN
    RAISE EXCEPTION 'permission is given for trips' USING ERRCODE = '23514';
  END IF;
  IF s.status <> 'scheduled' OR s.starts_at <= now() THEN
    RAISE EXCEPTION 'the trip has started or is cancelled' USING ERRCODE = 'PY007';
  END IF;
  IF NEW.policy_version_id IS DISTINCT FROM catalog.current_trip_consent(s.offering_id) THEN
    RAISE EXCEPTION 'the permission is not for the trip''s current wording' USING ERRCODE = 'PY016';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM people.guardian_relationship g
                  WHERE g.guardian_person_id = NEW.given_by_person_id AND g.student_person_id = NEW.student_person_id
                    AND g.status = 'active' AND g.can_consent) THEN
    RAISE EXCEPTION 'only a guardian who may consent for the child gives permission' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scheduling.check_trip_permission() FROM PUBLIC;
CREATE TRIGGER check_permission BEFORE INSERT ON scheduling.trip_permission
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_trip_permission();

-- No trip booking without a given permission for the trip's current wording.
CREATE FUNCTION scheduling.check_trip_booking() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  offering uuid;
BEGIN
  SELECT x.offering_id INTO offering
    FROM scheduling.session x
    JOIN catalog.school_offering o ON o.id = x.offering_id
    JOIN catalog.service_definition d ON d.id = o.service_definition_id
   WHERE x.id = NEW.session_id AND d.kind = 'trip';
  IF offering IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM scheduling.trip_permission p
                  WHERE p.session_id = NEW.session_id AND p.student_person_id = NEW.student_person_id
                    AND p.status = 'given' AND p.policy_version_id = catalog.current_trip_consent(offering)) THEN
    RAISE EXCEPTION 'a guardian''s permission for this trip is needed first' USING ERRCODE = 'PY016';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scheduling.check_trip_booking() FROM PUBLIC;
CREATE TRIGGER check_trip_permission BEFORE INSERT ON scheduling.booking
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_trip_booking();

-- Withdrawing permission before the trip: the place is cancelled, and what was
-- paid becomes credit (the worker issues it). Returns 'withdrawn' or
-- 'withdrawn_and_cancelled'.
CREATE FUNCTION scheduling.withdraw_trip_permission(p_permission_id uuid) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
  p record;
  b record;
BEGIN
  SELECT tp.*, s.starts_at INTO p
    FROM scheduling.trip_permission tp JOIN scheduling.session s ON s.id = tp.session_id
   WHERE tp.id = p_permission_id
   FOR UPDATE OF tp;
  IF me IS NULL OR NOT FOUND
     OR NOT (access.is_guardian_of(p.student_person_id, 'consent') OR access.has_permission('consent.manage', p.school_id)) THEN
    RAISE EXCEPTION 'no such permission' USING ERRCODE = 'P0002';
  END IF;
  IF p.status <> 'given' THEN
    RAISE EXCEPTION 'the permission is already withdrawn' USING ERRCODE = 'PY001';
  END IF;
  IF p.starts_at <= now() THEN
    RAISE EXCEPTION 'the trip has started' USING ERRCODE = 'PY007';
  END IF;

  SELECT bk.id, bk.status, bk.order_line_id, l.status AS line_status, o.status AS order_status INTO b
    FROM scheduling.booking bk
    LEFT JOIN commerce.order_line l ON l.id = bk.order_line_id
    LEFT JOIN commerce.customer_order o ON o.id = l.order_id
   WHERE bk.session_id = p.session_id AND bk.student_person_id = p.student_person_id
     AND bk.status IN ('reserved', 'confirmed')
   FOR UPDATE OF bk;
  IF FOUND AND b.status = 'reserved' THEN
    RAISE EXCEPTION 'a payment for this trip is still open; withdraw once it is paid or the reservation has expired'
      USING ERRCODE = 'PY017';
  END IF;

  UPDATE scheduling.trip_permission
     SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by_person_id = me
   WHERE id = p_permission_id;
  IF NOT FOUND OR b.id IS NULL THEN
    RETURN 'withdrawn';
  END IF;

  UPDATE scheduling.booking
     SET status = 'cancelled', cancelled_at = now(), cancelled_by_person_id = me,
         cancellation_reason = 'trip permission withdrawn'
   WHERE id = b.id;
  IF b.order_line_id IS NOT NULL AND b.line_status = 'confirmed' THEN
    UPDATE commerce.order_line SET status = 'cancelled' WHERE id = b.order_line_id;
    INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
    VALUES (p.group_id, 'commerce.order_line', b.order_line_id, 'commerce.order_line.cancelled',
            jsonb_build_object('order_line_id', b.order_line_id, 'booking_id', b.id, 'cause', 'consent_withdrawn'));
  END IF;
  RETURN 'withdrawn_and_cancelled';
END $$;
REVOKE ALL ON FUNCTION scheduling.withdraw_trip_permission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduling.withdraw_trip_permission(uuid) TO pyth_api;

ALTER TABLE scheduling.trip_permission ENABLE ROW LEVEL SECURITY;
GRANT SELECT,
      INSERT (id, group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel,
              recorded_by_person_id, emergency_contact_name, emergency_contact_phone)
  ON scheduling.trip_permission TO pyth_api;
CREATE POLICY read ON scheduling.trip_permission FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view') OR access.has_permission('bookings.read', school_id)
         OR access.has_permission('consent.manage', school_id));
-- A guardian gives it from the portal as themselves; staff record one given on paper or in person.
CREATE POLICY give ON scheduling.trip_permission FOR INSERT TO pyth_api
  WITH CHECK ((channel = 'family_portal' AND given_by_person_id = app.current_person_id()
               AND access.is_guardian_of(student_person_id, 'consent'))
              OR (channel IN ('paper', 'in_person') AND recorded_by_person_id = app.current_person_id()
                  AND access.has_permission('consent.manage', school_id)));

-- migrate:down
DROP FUNCTION scheduling.withdraw_trip_permission(uuid);
DROP TRIGGER check_trip_permission ON scheduling.booking;
DROP FUNCTION scheduling.check_trip_booking();
DROP TABLE scheduling.trip_permission;
DROP FUNCTION scheduling.check_trip_permission();
DELETE FROM meta.state_transition WHERE machine = 'trip_permission';
DROP FUNCTION catalog.current_trip_consent(uuid);
ALTER TABLE catalog.policy_version DROP CONSTRAINT policy_version_consent_wording, DROP CONSTRAINT policy_version_kind_check;
-- Policy versions are permanent, so trip wording already written stays; the old check applies to new rows.
ALTER TABLE catalog.policy_version ADD CONSTRAINT policy_version_kind_check CHECK (kind IN ('booking_and_cancellation', 'terms_of_sale')) NOT VALID;
