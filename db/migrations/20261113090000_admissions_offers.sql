-- migrate:up

-- Admissions M5.3: assessment notes, offers and the waiting list. An intake
-- never has more offers out (offered or accepted) than places: every offer is
-- made with the intake row locked, so two decisions at the same moment are
-- taken one after the other. An offer is answered by the parent who applied
-- before its deadline; a declined, expired or withdrawn place goes to the
-- longest-waiting application on the waiting list, with the intake's offer
-- period to answer. Every write goes through the functions below.

ALTER TABLE admissions.intake
  ADD COLUMN offer_days integer NOT NULL DEFAULT 14 CHECK (offer_days BETWEEN 1 AND 60);

ALTER TABLE admissions.application DROP CONSTRAINT application_status_check;
ALTER TABLE admissions.application
  ADD CONSTRAINT application_status_check CHECK (status IN (
    'submitted', 'under_review', 'waitlisted', 'offered', 'accepted', 'declined', 'expired', 'rejected', 'withdrawn')),
  ADD COLUMN waitlisted_at timestamptz,
  ADD COLUMN offered_at timestamptz,
  ADD COLUMN offer_expires_at timestamptz,
  ADD COLUMN decided_at timestamptz,
  ADD CONSTRAINT application_offer_check CHECK (status NOT IN ('offered', 'accepted', 'declined', 'expired')
                                                OR (offered_at IS NOT NULL AND offer_expires_at IS NOT NULL)),
  ADD CONSTRAINT application_waitlist_check CHECK (status <> 'waitlisted' OR waitlisted_at IS NOT NULL),
  ADD CONSTRAINT application_decided_check CHECK (status NOT IN ('accepted', 'declined', 'expired', 'rejected')
                                                  OR decided_at IS NOT NULL);
-- A refused, declined or expired application no longer blocks a new one.
DROP INDEX admissions.application_live_student_key;
DROP INDEX admissions.application_live_child_key;
CREATE UNIQUE INDEX application_live_student_key ON admissions.application (intake_id, student_person_id)
  WHERE status NOT IN ('withdrawn', 'rejected', 'declined', 'expired') AND student_person_id IS NOT NULL;
CREATE UNIQUE INDEX application_live_child_key
  ON admissions.application (intake_id, applicant_person_id, lower(child_given_name), lower(child_family_name), child_birth_date)
  WHERE status NOT IN ('withdrawn', 'rejected', 'declined', 'expired') AND student_person_id IS NULL;
CREATE INDEX application_waitlist_idx ON admissions.application (intake_id, waitlisted_at) WHERE status = 'waitlisted';
CREATE INDEX application_offer_expiry_idx ON admissions.application (offer_expires_at) WHERE status = 'offered';

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('application', 'submitted', 'waitlisted'), ('application', 'under_review', 'waitlisted'),
  ('application', 'submitted', 'offered'), ('application', 'under_review', 'offered'), ('application', 'waitlisted', 'offered'),
  ('application', 'submitted', 'rejected'), ('application', 'under_review', 'rejected'), ('application', 'waitlisted', 'rejected'),
  ('application', 'waitlisted', 'withdrawn'), ('application', 'offered', 'withdrawn'), ('application', 'accepted', 'withdrawn'),
  ('application', 'offered', 'accepted'), ('application', 'offered', 'declined'), ('application', 'offered', 'expired');

-- One rule for every admissions note table: the only change a note allows is
-- erasing its text (the M5.1 version knew only inquiry notes).
CREATE OR REPLACE FUNCTION admissions.protect_note() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL AND NEW.body IS NULL
     AND to_jsonb(NEW) - 'body' - 'erased_at' = to_jsonb(OLD) - 'body' - 'erased_at' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '%.% rows are permanent', TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'PY004';
END $$;

-- Assessment and interview notes: the school's admissions staff only, never
-- the family. Permanent, except that erasure (M5.6) may empty the text.
CREATE TABLE admissions.application_note (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id         uuid NOT NULL REFERENCES org.education_group (id),
  application_id   uuid NOT NULL REFERENCES admissions.application (id),
  author_person_id uuid NOT NULL REFERENCES people.person (id),
  kind             text NOT NULL CHECK (kind IN ('note', 'interview', 'assessment')),
  body             text CHECK (length(body) BETWEEN 1 AND 4000),
  erased_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((erased_at IS NULL) = (body IS NOT NULL))
);
CREATE INDEX application_note_application_idx ON admissions.application_note (application_id, created_at);
CREATE INDEX application_note_author_idx ON admissions.application_note (author_person_id);
CREATE TRIGGER protect_note BEFORE UPDATE OR DELETE ON admissions.application_note
  FOR EACH ROW EXECUTE FUNCTION admissions.protect_note();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON admissions.application_note
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('body');

-- The end of a day in the school's time zone.
CREATE FUNCTION admissions.end_of_day(p_day date, p_time_zone text) RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT ((p_day + 1)::timestamp AT TIME ZONE p_time_zone) $$;

-- Offers the free places of an intake to the longest-waiting applications.
-- The caller holds the intake row lock. Returns how many offers it made.
CREATE FUNCTION admissions.offer_next(p_intake_id uuid) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  i record;
  free integer;
  made integer := 0;
  next_id uuid;
BEGIN
  SELECT it.*, s.time_zone INTO i FROM admissions.intake it JOIN org.school s ON s.id = it.school_id WHERE it.id = p_intake_id;
  IF i.status <> 'open' THEN
    RETURN 0;
  END IF;
  SELECT i.places - count(*) INTO free FROM admissions.application
   WHERE intake_id = p_intake_id AND status IN ('offered', 'accepted');
  WHILE free > 0 LOOP
    SELECT id INTO next_id FROM admissions.application
     WHERE intake_id = p_intake_id AND status = 'waitlisted'
     ORDER BY waitlisted_at, submitted_at, id LIMIT 1 FOR UPDATE;
    EXIT WHEN NOT FOUND;
    UPDATE admissions.application
       SET status = 'offered', offered_at = now(),
           offer_expires_at = admissions.end_of_day((now() AT TIME ZONE i.time_zone)::date + i.offer_days, i.time_zone)
     WHERE id = next_id;
    free := free - 1;
    made := made + 1;
  END LOOP;
  RETURN made;
END $$;
REVOKE ALL ON FUNCTION admissions.offer_next(uuid) FROM PUBLIC;

-- Staff offer a place, to be answered by the end of p_answer_by (school time).
CREATE FUNCTION admissions.make_offer(p_application_id uuid, p_answer_by date) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  i record;
  taken integer;
BEGIN
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', a.school_id) THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  -- The intake first, then the application: every offer to this intake waits here.
  SELECT it.*, s.time_zone INTO i FROM admissions.intake it JOIN org.school s ON s.id = it.school_id
   WHERE it.id = a.intake_id FOR UPDATE OF it;
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id FOR UPDATE;
  IF a.status NOT IN ('submitted', 'under_review', 'waitlisted') THEN
    RAISE EXCEPTION 'this application cannot be offered a place now' USING ERRCODE = 'PY001';
  END IF;
  IF p_answer_by < (now() AT TIME ZONE i.time_zone)::date THEN
    RAISE EXCEPTION 'the answer date is in the past' USING ERRCODE = '22007';
  END IF;
  SELECT count(*) INTO taken FROM admissions.application WHERE intake_id = i.id AND status IN ('offered', 'accepted');
  IF taken >= i.places THEN
    RAISE EXCEPTION 'no place left in this intake; put the application on the waiting list' USING ERRCODE = 'PY024';
  END IF;
  UPDATE admissions.application
     SET status = 'offered', offered_at = now(), offer_expires_at = admissions.end_of_day(p_answer_by, i.time_zone)
   WHERE id = a.id;
END $$;
REVOKE ALL ON FUNCTION admissions.make_offer(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.make_offer(uuid, date) TO pyth_api;

-- Staff put an application on the waiting list, or refuse it.
CREATE FUNCTION admissions.decide_application(p_application_id uuid, p_decision text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', a.school_id) THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  IF p_decision = 'waitlisted' AND a.status IN ('submitted', 'under_review') THEN
    UPDATE admissions.application SET status = 'waitlisted', waitlisted_at = now() WHERE id = a.id;
  ELSIF p_decision = 'rejected' AND a.status IN ('submitted', 'under_review', 'waitlisted') THEN
    UPDATE admissions.application SET status = 'rejected', decided_at = now() WHERE id = a.id;
  ELSIF p_decision NOT IN ('waitlisted', 'rejected') THEN
    RAISE EXCEPTION 'unknown decision' USING ERRCODE = '23514';
  ELSE
    RAISE EXCEPTION 'this application cannot be % now', p_decision USING ERRCODE = 'PY001';
  END IF;
END $$;
REVOKE ALL ON FUNCTION admissions.decide_application(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.decide_application(uuid, text) TO pyth_api;

-- The parent who applied accepts or declines an offer before its deadline.
-- A declined place goes to the waiting list at once.
CREATE FUNCTION admissions.answer_offer(p_application_id uuid, p_accept boolean) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  outcome text;
BEGIN
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id;
  IF NOT FOUND OR a.applicant_person_id IS DISTINCT FROM app.current_person_id() THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM admissions.intake WHERE id = a.intake_id FOR UPDATE;
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id FOR UPDATE;
  IF a.status <> 'offered' THEN
    RAISE EXCEPTION 'there is no open offer on this application' USING ERRCODE = 'PY001';
  END IF;
  IF a.offer_expires_at <= now() THEN
    RAISE EXCEPTION 'the offer has expired' USING ERRCODE = 'PY025';
  END IF;
  outcome := CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
  UPDATE admissions.application SET status = outcome, decided_at = now() WHERE id = a.id;
  IF NOT p_accept THEN
    PERFORM admissions.offer_next(a.intake_id);
  END IF;
  RETURN outcome;
END $$;
REVOKE ALL ON FUNCTION admissions.answer_offer(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.answer_offer(uuid, boolean) TO pyth_api;

-- Withdrawal now also gives back an offered or accepted place.
CREATE OR REPLACE FUNCTION admissions.withdraw_application(p_application_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM admissions.application WHERE id = p_application_id;
  IF NOT FOUND OR r.applicant_person_id IS DISTINCT FROM app.current_person_id() THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM admissions.intake WHERE id = r.intake_id FOR UPDATE;
  SELECT * INTO r FROM admissions.application WHERE id = p_application_id FOR UPDATE;
  IF r.status = 'withdrawn' THEN
    RAISE EXCEPTION 'the application is already withdrawn' USING ERRCODE = 'PY001';
  END IF;
  -- Other transitions are checked by the state machine (PY001).
  UPDATE admissions.application SET status = 'withdrawn', withdrawn_at = now() WHERE id = r.id;
  IF r.status IN ('offered', 'accepted') THEN
    PERFORM admissions.offer_next(r.intake_id);
  END IF;
END $$;

-- The worker expires offers past their deadline and passes their places on.
CREATE FUNCTION admissions.expire_offers() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_intake uuid;
  expired integer := 0;
  n integer;
BEGIN
  FOR v_intake IN
    SELECT DISTINCT intake_id FROM admissions.application WHERE status = 'offered' AND offer_expires_at <= now()
  LOOP
    PERFORM 1 FROM admissions.intake WHERE id = v_intake FOR UPDATE;
    UPDATE admissions.application SET status = 'expired', decided_at = now()
     WHERE intake_id = v_intake AND status = 'offered' AND offer_expires_at <= now();
    GET DIAGNOSTICS n = ROW_COUNT;
    expired := expired + n;
    PERFORM admissions.offer_next(v_intake);
  END LOOP;
  RETURN expired;
END $$;
REVOKE ALL ON FUNCTION admissions.expire_offers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.expire_offers() TO pyth_worker;

-- A waiting application's place in the queue (1 is offered next). Only a
-- number, and only to those who see the application: the parent who applied
-- and the school's admissions staff.
CREATE FUNCTION admissions.waitlist_position(p_application_id uuid) RETURNS integer
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT (SELECT count(*)::int FROM admissions.application o
           WHERE o.intake_id = a.intake_id AND o.status = 'waitlisted'
             AND (o.waitlisted_at, o.submitted_at, o.id) <= (a.waitlisted_at, a.submitted_at, a.id))
    FROM admissions.application a
   WHERE a.id = p_application_id AND a.status = 'waitlisted'
     AND (a.applicant_person_id = app.current_person_id() OR access.has_permission('admissions.manage', a.school_id))
$$;
REVOKE ALL ON FUNCTION admissions.waitlist_position(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.waitlist_position(uuid) TO pyth_api;

-- Staff write assessment and interview notes.
CREATE FUNCTION admissions.add_application_note(p_application_id uuid, p_kind text, p_body text) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
  note uuid;
BEGIN
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', a.school_id) THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO admissions.application_note (group_id, application_id, author_person_id, kind, body)
  VALUES (a.group_id, a.id, app.current_person_id(), p_kind, btrim(p_body))
  RETURNING id INTO note;
  RETURN note;
END $$;
REVOKE ALL ON FUNCTION admissions.add_application_note(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.add_application_note(uuid, text, text) TO pyth_api;

ALTER TABLE admissions.application_note ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON admissions.application_note TO pyth_api;
-- Notes: the school's admissions staff only, not the family that applied.
CREATE POLICY read ON admissions.application_note FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM admissions.application a
                  WHERE a.id = application_id AND access.has_permission('admissions.manage', a.school_id)));

-- migrate:down
DROP FUNCTION admissions.add_application_note(uuid, text, text);
DROP FUNCTION admissions.waitlist_position(uuid);
DROP FUNCTION admissions.expire_offers();
DROP FUNCTION admissions.answer_offer(uuid, boolean);
DROP FUNCTION admissions.decide_application(uuid, text);
DROP FUNCTION admissions.make_offer(uuid, date);
DROP FUNCTION admissions.offer_next(uuid);
DROP FUNCTION admissions.end_of_day(date, text);
DROP TABLE admissions.application_note;
CREATE OR REPLACE FUNCTION admissions.protect_note() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL AND NEW.body IS NULL
     AND (NEW.id, NEW.group_id, NEW.inquiry_id, NEW.author_person_id, NEW.kind, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.group_id, OLD.inquiry_id, OLD.author_person_id, OLD.kind, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'admissions.inquiry_note rows are permanent' USING ERRCODE = 'PY004';
END $$;
-- Withdrawal as M5.2 had it.
CREATE OR REPLACE FUNCTION admissions.withdraw_application(p_application_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM admissions.application WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND OR r.applicant_person_id IS DISTINCT FROM app.current_person_id() THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  IF r.status = 'withdrawn' THEN
    RAISE EXCEPTION 'the application is already withdrawn' USING ERRCODE = 'PY001';
  END IF;
  UPDATE admissions.application SET status = 'withdrawn', withdrawn_at = now() WHERE id = r.id;
END $$;
DELETE FROM meta.state_transition WHERE machine = 'application'
   AND (from_state, to_state) NOT IN (('submitted', 'under_review'), ('submitted', 'withdrawn'), ('under_review', 'withdrawn'));
DROP INDEX admissions.application_offer_expiry_idx;
DROP INDEX admissions.application_waitlist_idx;
DROP INDEX admissions.application_live_child_key;
DROP INDEX admissions.application_live_student_key;
CREATE UNIQUE INDEX application_live_student_key ON admissions.application (intake_id, student_person_id)
  WHERE status <> 'withdrawn' AND student_person_id IS NOT NULL;
CREATE UNIQUE INDEX application_live_child_key
  ON admissions.application (intake_id, applicant_person_id, lower(child_given_name), lower(child_family_name), child_birth_date)
  WHERE status <> 'withdrawn' AND student_person_id IS NULL;
ALTER TABLE admissions.application
  DROP CONSTRAINT application_decided_check,
  DROP CONSTRAINT application_waitlist_check,
  DROP CONSTRAINT application_offer_check,
  DROP COLUMN decided_at,
  DROP COLUMN offer_expires_at,
  DROP COLUMN offered_at,
  DROP COLUMN waitlisted_at,
  DROP CONSTRAINT application_status_check,
  -- NOT VALID: applications decided under M5.3 may still exist.
  ADD CONSTRAINT application_status_check CHECK (status IN ('submitted', 'under_review', 'withdrawn')) NOT VALID;
ALTER TABLE admissions.intake DROP COLUMN offer_days;
