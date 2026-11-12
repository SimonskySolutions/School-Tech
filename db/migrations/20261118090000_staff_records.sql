-- migrate:up

-- Staff records (M6.1, ADR 0028). An employment says that a legal entity of
-- the group employs a person, at a school or group-wide, in a position, on a
-- contract and working-time fraction, between two dates. It is separate from
-- the role assignments that give platform access. No payroll data: no
-- national number, address, salary or bank details. Every write goes through
-- the functions below; row-level security decides who reads.

CREATE SCHEMA staff;
COMMENT ON SCHEMA staff IS 'Staff records: employments, later qualifications and development (ADR 0028). No payroll data.';
REVOKE ALL ON SCHEMA staff FROM PUBLIC;
GRANT USAGE ON SCHEMA staff TO pyth_api, pyth_worker;

INSERT INTO access.permission (code, description) VALUES
  ('staff.read', 'Read the staff records of the school'),
  ('staff.manage', 'Record and end the employments of the school''s staff');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('group_ceo', 'staff.read'), ('group_admin', 'staff.read'), ('principal', 'staff.read'), ('school_admin', 'staff.read'),
  ('group_admin', 'staff.manage'), ('principal', 'staff.manage'), ('school_admin', 'staff.manage');

CREATE TABLE staff.employment (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id             uuid NOT NULL,
  person_id            uuid NOT NULL,
  employer_id          uuid NOT NULL,
  -- The workplace; NULL for group-wide staff.
  school_id            uuid,
  position             text NOT NULL CHECK (length(position) BETWEEN 1 AND 100),
  contract_kind        text NOT NULL CHECK (contract_kind IN ('permanent', 'fixed_term', 'temporary')),
  working_time         numeric(3, 2) NOT NULL CHECK (working_time > 0 AND working_time <= 1),
  start_date           date NOT NULL,
  end_date             date,
  work_email           text CHECK (work_email = lower(work_email) AND work_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  work_phone           text CHECK (work_phone ~ '^\+[1-9][0-9]{6,14}$'),
  created_by_person_id uuid REFERENCES people.person (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (employer_id, group_id) REFERENCES org.legal_entity (id, group_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  CHECK (end_date IS NULL OR end_date >= start_date),
  -- A fixed-term contract has a planned end.
  CHECK (contract_kind <> 'fixed_term' OR end_date IS NOT NULL)
);
CREATE INDEX employment_person_idx ON staff.employment (person_id);
CREATE INDEX employment_school_idx ON staff.employment (school_id, end_date);
CREATE INDEX employment_employer_idx ON staff.employment (employer_id);
CREATE INDEX employment_created_by_idx ON staff.employment (created_by_person_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff.employment FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON staff.employment
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('work_email', 'work_phone');

-- staff.manage where the employment is: at the school, or group-wide.
CREATE FUNCTION staff.may(p_permission text, p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL AND access.has_permission(p_permission, p_school_id)
$$;
REVOKE ALL ON FUNCTION staff.may(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.may(text, uuid) TO pyth_api;

-- Record an employment of someone who works at the school: registered there
-- or holding a role there (for group-wide staff, a group role).
CREATE FUNCTION staff.record_employment(
  p_person_id uuid, p_employer_id uuid, p_school_id uuid, p_position text, p_contract_kind text,
  p_working_time numeric, p_start_date date, p_end_date date, p_work_email text, p_work_phone text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  grp constant uuid := access.current_group_id();
  employment uuid;
BEGIN
  IF NOT staff.may('staff.manage', p_school_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM people.person p
        WHERE p.id = p_person_id AND p.group_id = grp AND p.status = 'active'
          AND ((p_school_id IS NOT NULL AND p.registered_school_id = p_school_id)
               OR EXISTS (SELECT 1 FROM access.role_assignment ra
                           WHERE ra.person_id = p.id AND ra.revoked_at IS NULL
                             AND ra.school_id IS NOT DISTINCT FROM p_school_id))) THEN
    RAISE EXCEPTION 'no such member of staff at this school' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO staff.employment (group_id, person_id, employer_id, school_id, position, contract_kind, working_time,
                                start_date, end_date, work_email, work_phone, created_by_person_id)
  VALUES (grp, p_person_id, p_employer_id, p_school_id, btrim(p_position), p_contract_kind, p_working_time,
          p_start_date, p_end_date, nullif(lower(btrim(p_work_email)), ''), nullif(btrim(p_work_phone), ''),
          app.current_person_id())
  RETURNING id INTO employment;
  RETURN employment;
END $$;
REVOKE ALL ON FUNCTION staff.record_employment(uuid, uuid, uuid, text, text, numeric, date, date, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.record_employment(uuid, uuid, uuid, text, text, numeric, date, date, text, text) TO pyth_api;

-- End an employment on a day, or bring a planned end forward. Roles stay as
-- they are (ADR 0028); the staff page shows the difference.
CREATE FUNCTION staff.end_employment(p_employment_id uuid, p_end_date date) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  e record;
BEGIN
  SELECT * INTO e FROM staff.employment WHERE id = p_employment_id FOR UPDATE;
  IF NOT FOUND OR NOT staff.may('staff.manage', e.school_id) THEN
    RAISE EXCEPTION 'no such employment' USING ERRCODE = 'P0002';
  END IF;
  IF e.end_date IS NOT NULL AND e.end_date <= p_end_date THEN
    RAISE EXCEPTION 'the employment already ends by then' USING ERRCODE = 'PY001';
  END IF;
  UPDATE staff.employment SET end_date = p_end_date WHERE id = e.id;
END $$;
REVOKE ALL ON FUNCTION staff.end_employment(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.end_employment(uuid, date) TO pyth_api;

-- Who works at a school, for its staff page: people registered there or with
-- a live role there, and their roles. Names and roles only, to staff.read.
CREATE FUNCTION staff.school_staff(p_school_id uuid)
RETURNS TABLE (person_id uuid, given_name text, family_name text, email text, roles text[])
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p.id, p.given_name, p.family_name, p.email,
         coalesce((SELECT array_agg(ra.role_code ORDER BY ra.role_code) FROM access.role_assignment ra
                    WHERE ra.person_id = p.id AND ra.school_id = p_school_id AND ra.revoked_at IS NULL
                      AND (ra.valid_until IS NULL OR ra.valid_until > now())), '{}')
    FROM people.person p
   WHERE staff.may('staff.read', p_school_id) AND p.status = 'active' AND p.group_id = access.current_group_id()
     AND (EXISTS (SELECT 1 FROM access.role_assignment ra
                   WHERE ra.person_id = p.id AND ra.school_id = p_school_id AND ra.revoked_at IS NULL
                     AND (ra.valid_until IS NULL OR ra.valid_until > now()))
          OR EXISTS (SELECT 1 FROM staff.employment e WHERE e.person_id = p.id AND e.school_id = p_school_id))
   ORDER BY p.family_name, p.given_name
$$;
REVOKE ALL ON FUNCTION staff.school_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.school_staff(uuid) TO pyth_api;

ALTER TABLE staff.employment ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON staff.employment TO pyth_api;
-- The person themself, and staff.read where they work (group-wide staff: group staff.read).
CREATE POLICY read ON staff.employment FOR SELECT TO pyth_api
  USING (person_id = app.current_person_id() OR staff.may('staff.read', school_id));

-- migrate:down
DROP FUNCTION staff.school_staff(uuid);
DROP FUNCTION staff.end_employment(uuid, date);
DROP FUNCTION staff.record_employment(uuid, uuid, uuid, text, text, numeric, date, date, text, text);
DROP TABLE staff.employment;
DROP FUNCTION staff.may(text, uuid);
DELETE FROM access.role_permission WHERE permission_code IN ('staff.read', 'staff.manage');
DELETE FROM access.permission WHERE code IN ('staff.read', 'staff.manage');
DROP SCHEMA staff;
