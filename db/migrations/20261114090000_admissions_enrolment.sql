-- migrate:up

-- Admissions M5.4: the hand-off. An accepted application is enrolled by the
-- school's staff in one transaction, exactly once: a child new to the group
-- becomes a person (the application's details move to the record and leave
-- the application), the parent who applied becomes their guardian, verified
-- by the member of staff, and the child is enrolled at the school for the
-- intake's year and grade. A child of the group is enrolled as they are; the
-- parent is already their guardian. Nothing here is decided by an e-mail match.

ALTER TABLE admissions.application DROP CONSTRAINT application_status_check;
ALTER TABLE admissions.application
  ADD CONSTRAINT application_status_check CHECK (status IN (
    'submitted', 'under_review', 'waitlisted', 'offered', 'accepted', 'enrolled',
    'declined', 'expired', 'rejected', 'withdrawn')),
  ADD COLUMN enrolment_id uuid REFERENCES people.enrolment (id),
  ADD COLUMN enrolled_at timestamptz,
  ADD COLUMN enrolled_by_person_id uuid REFERENCES people.person (id),
  ADD CONSTRAINT application_enrolled_check CHECK ((status = 'enrolled') = (enrolment_id IS NOT NULL)
                                                   AND (enrolment_id IS NULL) = (enrolled_at IS NULL)),
  DROP CONSTRAINT application_offer_check,
  ADD CONSTRAINT application_offer_check CHECK (status NOT IN ('offered', 'accepted', 'enrolled', 'declined', 'expired')
                                                OR (offered_at IS NOT NULL AND offer_expires_at IS NOT NULL)),
  DROP CONSTRAINT application_decided_check,
  ADD CONSTRAINT application_decided_check CHECK (status NOT IN ('accepted', 'enrolled', 'declined', 'expired', 'rejected')
                                                  OR decided_at IS NOT NULL);
CREATE UNIQUE INDEX application_enrolment_key ON admissions.application (enrolment_id);
CREATE INDEX application_enrolled_by_idx ON admissions.application (enrolled_by_person_id);
INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES ('application', 'accepted', 'enrolled');

-- An enrolled application holds its place for good.
CREATE OR REPLACE FUNCTION admissions.offer_next(p_intake_id uuid) RETURNS integer
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
   WHERE intake_id = p_intake_id AND status IN ('offered', 'accepted', 'enrolled');
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

CREATE OR REPLACE FUNCTION admissions.make_offer(p_application_id uuid, p_answer_by date) RETURNS void
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
  SELECT count(*) INTO taken FROM admissions.application
   WHERE intake_id = i.id AND status IN ('offered', 'accepted', 'enrolled');
  IF taken >= i.places THEN
    RAISE EXCEPTION 'no place left in this intake; put the application on the waiting list' USING ERRCODE = 'PY024';
  END IF;
  UPDATE admissions.application
     SET status = 'offered', offered_at = now(), offer_expires_at = admissions.end_of_day(p_answer_by, i.time_zone)
   WHERE id = a.id;
END $$;

-- The hand-off. Needs admissions, enrolment and guardian management at the
-- school (principals, school administrators, group administrators).
CREATE FUNCTION admissions.enrol_application(
  p_application_id uuid, p_start_date date, p_class_label text, p_relationship text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
  a record;
  i record;
  child uuid;
  enrolment uuid;
BEGIN
  SELECT * INTO a FROM admissions.application WHERE id = p_application_id FOR UPDATE;
  IF me IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', a.school_id) THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  IF NOT access.has_permission('enrolment.manage', a.school_id) OR NOT access.has_permission('guardians.manage', a.school_id) THEN
    RAISE EXCEPTION 'enrolling needs enrolment and guardian management at the school' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'accepted' THEN
    RAISE EXCEPTION 'only an accepted place is enrolled, and only once' USING ERRCODE = 'PY001';
  END IF;
  SELECT * INTO i FROM admissions.intake WHERE id = a.intake_id;

  IF a.student_person_id IS NOT NULL THEN
    child := a.student_person_id;
  ELSE
    IF p_relationship IS NULL THEN
      RAISE EXCEPTION 'say how the parent is related to the child' USING ERRCODE = '23514';
    END IF;
    INSERT INTO people.person (group_id, given_name, family_name, date_of_birth, registered_school_id)
    VALUES (a.group_id, a.child_given_name, a.child_family_name, a.child_birth_date, a.school_id)
    RETURNING id INTO child;
    -- The parent who applied, verified now by the member of staff who enrols.
    INSERT INTO people.guardian_relationship (group_id, guardian_person_id, student_person_id, relationship, can_consent,
                                              status, verified_by_person_id, verified_at)
    VALUES (a.group_id, a.applicant_person_id, child, p_relationship, true, 'active', me, now());
  END IF;

  INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, grade_level, class_label, status, start_date)
  VALUES (a.group_id, child, a.school_id, left(i.school_year, 5) || (left(i.school_year, 4)::int + 1)::text,
          i.grade, nullif(btrim(p_class_label), ''), 'active', p_start_date)
  RETURNING id INTO enrolment;

  -- The child's details now live on their record, not on the application.
  UPDATE admissions.application
     SET status = 'enrolled', enrolment_id = enrolment, enrolled_at = now(), enrolled_by_person_id = me,
         student_person_id = child, child_given_name = NULL, child_family_name = NULL, child_birth_date = NULL
   WHERE id = a.id;
  RETURN child;
END $$;
REVOKE ALL ON FUNCTION admissions.enrol_application(uuid, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.enrol_application(uuid, date, text, text) TO pyth_api;

-- migrate:down
DROP FUNCTION admissions.enrol_application(uuid, date, text, text);
CREATE OR REPLACE FUNCTION admissions.offer_next(p_intake_id uuid) RETURNS integer
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
CREATE OR REPLACE FUNCTION admissions.make_offer(p_application_id uuid, p_answer_by date) RETURNS void
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
DELETE FROM meta.state_transition WHERE machine = 'application' AND from_state = 'accepted' AND to_state = 'enrolled';
DROP INDEX admissions.application_enrolled_by_idx;
DROP INDEX admissions.application_enrolment_key;
ALTER TABLE admissions.application
  DROP CONSTRAINT application_decided_check,
  ADD CONSTRAINT application_decided_check CHECK (status NOT IN ('accepted', 'declined', 'expired', 'rejected')
                                                  OR decided_at IS NOT NULL) NOT VALID,
  DROP CONSTRAINT application_offer_check,
  ADD CONSTRAINT application_offer_check CHECK (status NOT IN ('offered', 'accepted', 'declined', 'expired')
                                                OR (offered_at IS NOT NULL AND offer_expires_at IS NOT NULL)) NOT VALID,
  DROP CONSTRAINT application_enrolled_check,
  DROP COLUMN enrolled_by_person_id,
  DROP COLUMN enrolled_at,
  DROP COLUMN enrolment_id,
  DROP CONSTRAINT application_status_check,
  -- NOT VALID: applications enrolled under M5.4 may still exist.
  ADD CONSTRAINT application_status_check CHECK (status IN (
    'submitted', 'under_review', 'waitlisted', 'offered', 'accepted', 'declined', 'expired', 'rejected', 'withdrawn')) NOT VALID;
