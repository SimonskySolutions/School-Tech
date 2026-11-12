-- migrate:up

-- Admissions M5.2 (ADR 0027): intakes per school, school year and grade;
-- applications from signed-in parents, for one of their children or for a
-- child the group does not know yet; and invitations that give the sender of
-- an inquiry a person record and a sign-in so they can apply. The child of a
-- new family stays application data until the hand-off (M5.4). Every write
-- goes through the functions below; row-level security decides who reads.

CREATE TABLE admissions.intake (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id             uuid NOT NULL,
  school_id            uuid NOT NULL,
  school_year          text NOT NULL CHECK (school_year ~ '^[0-9]{4}/[0-9]{2}$'
                         AND right(school_year, 2)::int = (left(school_year, 4)::int + 1) % 100),
  grade                text NOT NULL CHECK (length(grade) BETWEEN 1 AND 20),
  places               integer NOT NULL CHECK (places BETWEEN 1 AND 1000),
  opens_on             date NOT NULL,
  closes_on            date NOT NULL,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by_person_id uuid REFERENCES people.person (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  UNIQUE (school_id, school_year, grade),
  UNIQUE (id, school_id),
  CHECK (closes_on >= opens_on)
);
CREATE INDEX intake_created_by_idx ON admissions.intake (created_by_person_id);
INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES ('intake', 'open', 'closed');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON admissions.intake
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('intake');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON admissions.intake FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON admissions.intake
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

CREATE TABLE admissions.application (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id            uuid NOT NULL,
  school_id           uuid NOT NULL,
  intake_id           uuid NOT NULL,
  applicant_person_id uuid NOT NULL,
  -- One of the applicant's children, or (for a child the group does not know) the child's details.
  student_person_id   uuid,
  child_given_name    text CHECK (length(child_given_name) BETWEEN 1 AND 100),
  child_family_name   text CHECK (length(child_family_name) BETWEEN 1 AND 100),
  child_birth_date    date CHECK (child_birth_date > DATE '2000-01-01'),
  current_school      text CHECK (length(current_school) BETWEEN 1 AND 200),
  message             text CHECK (length(message) BETWEEN 1 AND 2000),
  notice_id           uuid NOT NULL REFERENCES admissions.privacy_notice (id),
  status              text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'withdrawn')),
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  withdrawn_at        timestamptz,
  erased_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (intake_id, school_id) REFERENCES admissions.intake (id, school_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  FOREIGN KEY (applicant_person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)),
  CHECK (student_person_id IS NULL OR (child_given_name IS NULL AND child_family_name IS NULL AND child_birth_date IS NULL)),
  CHECK (erased_at IS NOT NULL OR student_person_id IS NOT NULL
         OR (child_given_name IS NOT NULL AND child_family_name IS NOT NULL AND child_birth_date IS NOT NULL))
);
CREATE INDEX application_school_idx ON admissions.application (school_id, status, submitted_at);
CREATE INDEX application_intake_idx ON admissions.application (intake_id);
CREATE INDEX application_applicant_idx ON admissions.application (applicant_person_id);
CREATE INDEX application_student_idx ON admissions.application (student_person_id);
CREATE INDEX application_notice_idx ON admissions.application (notice_id);
-- One live application per child and intake.
CREATE UNIQUE INDEX application_live_student_key ON admissions.application (intake_id, student_person_id)
  WHERE status <> 'withdrawn' AND student_person_id IS NOT NULL;
CREATE UNIQUE INDEX application_live_child_key
  ON admissions.application (intake_id, applicant_person_id, lower(child_given_name), lower(child_family_name), child_birth_date)
  WHERE status <> 'withdrawn' AND student_person_id IS NULL;

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('application', 'submitted', 'under_review'), ('application', 'submitted', 'withdrawn'),
  ('application', 'under_review', 'withdrawn');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON admissions.application
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('application');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON admissions.application FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON admissions.application
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('child_given_name', 'child_family_name', 'child_birth_date', 'current_school', 'message');

-- The parent an inquiry's sender became when invited to apply.
ALTER TABLE admissions.inquiry
  ADD COLUMN applicant_person_id uuid REFERENCES people.person (id),
  ADD COLUMN invited_at timestamptz,
  ADD CONSTRAINT inquiry_invited_check CHECK ((applicant_person_id IS NULL) = (invited_at IS NULL));
CREATE INDEX inquiry_applicant_idx ON admissions.inquiry (applicant_person_id);

-- Staff open an intake for a school, school year and grade.
CREATE FUNCTION admissions.open_intake(
  p_school_id uuid, p_school_year text, p_grade text, p_places integer, p_opens_on date, p_closes_on date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  intake uuid;
BEGIN
  IF app.current_person_id() IS NULL OR NOT access.has_permission('admissions.manage', p_school_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  INSERT INTO admissions.intake (group_id, school_id, school_year, grade, places, opens_on, closes_on, created_by_person_id)
  SELECT s.group_id, s.id, p_school_year, btrim(p_grade), p_places, p_opens_on, p_closes_on, app.current_person_id()
    FROM org.school s WHERE s.id = p_school_id
  RETURNING id INTO intake;
  RETURN intake;
END $$;
REVOKE ALL ON FUNCTION admissions.open_intake(uuid, text, text, integer, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.open_intake(uuid, text, text, integer, date, date) TO pyth_api;

CREATE FUNCTION admissions.close_intake(p_intake_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM admissions.intake WHERE id = p_intake_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', r.school_id) THEN
    RAISE EXCEPTION 'no such intake' USING ERRCODE = 'P0002';
  END IF;
  IF r.status = 'closed' THEN
    RAISE EXCEPTION 'the intake is already closed' USING ERRCODE = 'PY001';
  END IF;
  UPDATE admissions.intake SET status = 'closed' WHERE id = r.id;
END $$;
REVOKE ALL ON FUNCTION admissions.close_intake(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.close_intake(uuid) TO pyth_api;

-- A signed-in parent applies: for one of their children (as a guardian who
-- may consent for them), or for a child the group does not know yet.
CREATE FUNCTION admissions.submit_application(
  p_intake_id uuid, p_notice_id uuid, p_student_id uuid,
  p_child_given_name text, p_child_family_name text, p_child_birth_date date,
  p_current_school text, p_message text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
  i record;
  today date;
  current_notice uuid;
  application uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT it.*, s.time_zone INTO i
    FROM admissions.intake it JOIN org.school s ON s.id = it.school_id
   WHERE it.id = p_intake_id AND it.group_id = access.current_group_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such intake' USING ERRCODE = 'P0002';
  END IF;
  today := (now() AT TIME ZONE i.time_zone)::date;
  IF i.status <> 'open' OR today < i.opens_on OR today > i.closes_on THEN
    RAISE EXCEPTION 'this intake is not taking applications' USING ERRCODE = 'PY022';
  END IF;
  SELECT id INTO current_notice FROM admissions.privacy_notice WHERE group_id = i.group_id ORDER BY version DESC LIMIT 1;
  IF current_notice IS DISTINCT FROM p_notice_id THEN
    RAISE EXCEPTION 'the privacy notice has changed; please read it again' USING ERRCODE = 'PY020';
  END IF;
  IF p_student_id IS NOT NULL THEN
    IF NOT access.is_guardian_of(p_student_id, 'consent') THEN
      RAISE EXCEPTION 'no such child' USING ERRCODE = 'P0002';
    END IF;
    IF EXISTS (SELECT 1 FROM people.enrolment e
                WHERE e.student_person_id = p_student_id AND e.school_id = i.school_id AND e.status = 'active') THEN
      RAISE EXCEPTION 'the child already attends this school' USING ERRCODE = '23505';
    END IF;
  END IF;
  INSERT INTO admissions.application (group_id, school_id, intake_id, applicant_person_id, student_person_id,
                                      child_given_name, child_family_name, child_birth_date, current_school, message, notice_id)
  VALUES (i.group_id, i.school_id, i.id, me, p_student_id,
          CASE WHEN p_student_id IS NULL THEN nullif(btrim(p_child_given_name), '') END,
          CASE WHEN p_student_id IS NULL THEN nullif(btrim(p_child_family_name), '') END,
          CASE WHEN p_student_id IS NULL THEN p_child_birth_date END,
          nullif(btrim(p_current_school), ''), nullif(btrim(p_message), ''), p_notice_id)
  RETURNING id INTO application;
  RETURN application;
END $$;
REVOKE ALL ON FUNCTION admissions.submit_application(uuid, uuid, uuid, text, text, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.submit_application(uuid, uuid, uuid, text, text, date, text, text) TO pyth_api;

-- The parent who applied withdraws the application, before any decision.
CREATE FUNCTION admissions.withdraw_application(p_application_id uuid) RETURNS void
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
  -- Other transitions are checked by the state machine (PY001).
  UPDATE admissions.application SET status = 'withdrawn', withdrawn_at = now() WHERE id = r.id;
END $$;
REVOKE ALL ON FUNCTION admissions.withdraw_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.withdraw_application(uuid) TO pyth_api;

-- Admissions staff take an application into review.
CREATE FUNCTION admissions.review_application(p_application_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM admissions.application WHERE id = p_application_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', r.school_id) THEN
    RAISE EXCEPTION 'no such application' USING ERRCODE = 'P0002';
  END IF;
  IF r.status <> 'submitted' THEN
    RAISE EXCEPTION 'only a submitted application is taken into review' USING ERRCODE = 'PY001';
  END IF;
  UPDATE admissions.application SET status = 'under_review' WHERE id = r.id;
END $$;
REVOKE ALL ON FUNCTION admissions.review_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.review_application(uuid) TO pyth_api;

-- Staff invite the sender of an open inquiry to apply: a person record for
-- the parent, registered at the inquiry's school, only if nobody in the group
-- has the address (an e-mail match never yields access, ADR 0027). Asking
-- again returns the same person, so a failed account creation can be retried.
CREATE FUNCTION admissions.invite_applicant(p_inquiry_id uuid, p_given_name text, p_family_name text)
RETURNS TABLE (person_id uuid, email text, has_login boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  person uuid;
BEGIN
  SELECT * INTO r FROM admissions.inquiry WHERE id = p_inquiry_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', r.school_id) THEN
    RAISE EXCEPTION 'no such inquiry' USING ERRCODE = 'P0002';
  END IF;
  IF r.status = 'closed' THEN
    RAISE EXCEPTION 'the inquiry is closed' USING ERRCODE = 'PY001';
  END IF;
  IF r.applicant_person_id IS NOT NULL THEN
    person := r.applicant_person_id;
  ELSE
    IF EXISTS (SELECT 1 FROM people.person p WHERE p.group_id = r.group_id AND p.email = r.email AND p.status = 'active') THEN
      RAISE EXCEPTION 'this address is already known to the group' USING ERRCODE = 'PY023';
    END IF;
    INSERT INTO people.person (group_id, given_name, family_name, email, registered_school_id)
    VALUES (r.group_id, btrim(p_given_name), btrim(p_family_name), r.email, r.school_id)
    RETURNING id INTO person;
    UPDATE admissions.inquiry SET applicant_person_id = person, invited_at = now(), last_activity_at = now() WHERE id = r.id;
  END IF;
  RETURN QUERY
    SELECT p.id, p.email, EXISTS (SELECT 1 FROM people.login_identity li WHERE li.person_id = p.id)
      FROM people.person p WHERE p.id = person;
END $$;
REVOKE ALL ON FUNCTION admissions.invite_applicant(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.invite_applicant(uuid, text, text) TO pyth_api;

-- Links the sign-in account created for an invited parent. Only for a person
-- created by an invitation at a school where the caller handles admissions,
-- with no login, role or guardian relationship yet.
CREATE FUNCTION admissions.link_applicant_login(p_person_id uuid, p_subject text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  grp uuid;
BEGIN
  SELECT i.group_id INTO grp FROM admissions.inquiry i
   WHERE i.applicant_person_id = p_person_id AND access.has_permission('admissions.manage', i.school_id)
   LIMIT 1;
  IF app.current_person_id() IS NULL OR grp IS NULL
     OR EXISTS (SELECT 1 FROM people.login_identity WHERE person_id = p_person_id)
     OR EXISTS (SELECT 1 FROM access.role_assignment WHERE person_id = p_person_id)
     OR EXISTS (SELECT 1 FROM people.guardian_relationship WHERE guardian_person_id = p_person_id OR student_person_id = p_person_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  INSERT INTO people.login_identity (person_id, group_id, provider, subject) VALUES (p_person_id, grp, 'keycloak', p_subject);
END $$;
REVOKE ALL ON FUNCTION admissions.link_applicant_login(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.link_applicant_login(uuid, text) TO pyth_api;

ALTER TABLE admissions.intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE admissions.application ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON admissions.intake, admissions.application TO pyth_api;
-- Open intakes are for every signed-in person of the group; closed ones for the school's admissions staff.
CREATE POLICY read ON admissions.intake FOR SELECT TO pyth_api
  USING ((status = 'open' AND app.current_person_id() IS NOT NULL AND group_id = access.current_group_id())
         OR access.has_permission('admissions.manage', school_id));
-- An application: the parent who applied, and the school's admissions staff.
CREATE POLICY read ON admissions.application FOR SELECT TO pyth_api
  USING (applicant_person_id = app.current_person_id() OR access.has_permission('admissions.manage', school_id));
-- The school applied to reads the person records of the children and parents
-- applying there, and nothing else about them (their other schools' data
-- stays behind its own rules).
CREATE POLICY admissions_read ON people.person FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM admissions.application a
                  WHERE (a.student_person_id = person.id OR a.applicant_person_id = person.id)
                    AND access.has_permission('admissions.manage', a.school_id)));

-- migrate:down
DROP POLICY admissions_read ON people.person;
DROP FUNCTION admissions.link_applicant_login(uuid, text);
DROP FUNCTION admissions.invite_applicant(uuid, text, text);
DROP FUNCTION admissions.review_application(uuid);
DROP FUNCTION admissions.withdraw_application(uuid);
DROP FUNCTION admissions.submit_application(uuid, uuid, uuid, text, text, date, text, text);
DROP FUNCTION admissions.close_intake(uuid);
DROP FUNCTION admissions.open_intake(uuid, text, text, integer, date, date);
ALTER TABLE admissions.inquiry DROP CONSTRAINT inquiry_invited_check, DROP COLUMN invited_at, DROP COLUMN applicant_person_id;
DROP TABLE admissions.application;
DROP TABLE admissions.intake;
DELETE FROM meta.state_transition WHERE machine IN ('intake', 'application');
