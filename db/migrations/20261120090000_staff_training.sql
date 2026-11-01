-- migrate:up

-- Professional development (M6.3, ADR 0028): training a member of staff has
-- attended or plans to attend, with its hours, counted per school year
-- (September to August). The person records their own; the leaders of a
-- school where they work now record it for them too. Read like their
-- qualifications: by the person and staff.read where they work now.

-- The school year a day falls in, as "2026/27" (September to August).
CREATE FUNCTION staff.school_year(p_day date) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN extract(month FROM p_day) >= 9
              THEN extract(year FROM p_day)::int || '/' || lpad(((extract(year FROM p_day)::int + 1) % 100)::text, 2, '0')
              ELSE (extract(year FROM p_day)::int - 1) || '/' || lpad((extract(year FROM p_day)::int % 100)::text, 2, '0') END
$$;
GRANT EXECUTE ON FUNCTION staff.school_year(date) TO pyth_api;

CREATE TABLE staff.training (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  person_id             uuid NOT NULL,
  title                 text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  provider              text CHECK (length(provider) BETWEEN 1 AND 200),
  kind                  text NOT NULL CHECK (kind IN ('course', 'conference', 'workshop', 'in_school', 'online', 'other')),
  starts_on             date NOT NULL,
  ends_on               date NOT NULL,
  hours                 numeric(5, 1) NOT NULL CHECK (hours > 0 AND hours <= 500),
  status                text NOT NULL CHECK (status IN ('planned', 'attended', 'cancelled')),
  school_year           text GENERATED ALWAYS AS (staff.school_year(starts_on)) STORED,
  recorded_by_person_id uuid REFERENCES people.person (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX training_person_idx ON staff.training (person_id, school_year);
CREATE INDEX training_recorded_by_idx ON staff.training (recorded_by_person_id);
INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('training', 'planned', 'attended'), ('training', 'planned', 'cancelled');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON staff.training
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('training');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff.training FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON staff.training
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

-- The person themself, or staff.manage where they work now.
CREATE FUNCTION staff.may_record_for(p_person_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL
     AND (p_person_id = app.current_person_id() OR staff.may_for_person('staff.manage', p_person_id))
$$;
REVOKE ALL ON FUNCTION staff.may_record_for(uuid) FROM PUBLIC;

CREATE FUNCTION staff.record_training(
  p_person_id uuid, p_title text, p_provider text, p_kind text, p_starts_on date, p_ends_on date,
  p_hours numeric, p_status text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  training uuid;
BEGIN
  IF NOT staff.may_record_for(p_person_id) THEN
    RAISE EXCEPTION 'no such member of staff at your schools' USING ERRCODE = 'P0002';
  END IF;
  -- Only someone who works in the group keeps a development record.
  IF NOT EXISTS (SELECT 1 FROM staff.current_schools(p_person_id))
     AND NOT EXISTS (SELECT 1 FROM staff.employment e WHERE e.person_id = p_person_id
                       AND e.start_date <= current_date AND (e.end_date IS NULL OR e.end_date >= current_date))
     AND NOT EXISTS (SELECT 1 FROM access.role_assignment ra WHERE ra.person_id = p_person_id AND ra.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'only staff keep a development record' USING ERRCODE = 'P0002';
  END IF;
  IF p_status NOT IN ('planned', 'attended') THEN
    RAISE EXCEPTION 'training is recorded as planned or attended' USING ERRCODE = '23514';
  END IF;
  IF p_status = 'attended' AND p_starts_on > current_date THEN
    RAISE EXCEPTION 'training in the future is planned, not attended' USING ERRCODE = '23514';
  END IF;
  INSERT INTO staff.training (group_id, person_id, title, provider, kind, starts_on, ends_on, hours, status, recorded_by_person_id)
  VALUES (access.current_group_id(), p_person_id, btrim(p_title), nullif(btrim(p_provider), ''), p_kind, p_starts_on,
          p_ends_on, p_hours, p_status, app.current_person_id())
  RETURNING id INTO training;
  RETURN training;
END $$;
REVOKE ALL ON FUNCTION staff.record_training(uuid, text, text, text, date, date, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.record_training(uuid, text, text, text, date, date, numeric, text) TO pyth_api;

-- Planned training is attended (once it has started) or cancelled.
CREATE FUNCTION staff.set_training_status(p_training_id uuid, p_status text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  t record;
BEGIN
  SELECT * INTO t FROM staff.training WHERE id = p_training_id FOR UPDATE;
  IF NOT FOUND OR NOT staff.may_record_for(t.person_id) THEN
    RAISE EXCEPTION 'no such training' USING ERRCODE = 'P0002';
  END IF;
  IF t.status <> 'planned' THEN
    RAISE EXCEPTION 'only planned training changes' USING ERRCODE = 'PY001';
  END IF;
  IF p_status = 'attended' AND t.starts_on > current_date THEN
    RAISE EXCEPTION 'training that has not started is not attended yet' USING ERRCODE = '23514';
  END IF;
  -- Other states are refused by the state machine (PY001).
  UPDATE staff.training SET status = p_status WHERE id = t.id;
END $$;
REVOKE ALL ON FUNCTION staff.set_training_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.set_training_status(uuid, text) TO pyth_api;

ALTER TABLE staff.training ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON staff.training TO pyth_api;
CREATE POLICY read ON staff.training FOR SELECT TO pyth_api
  USING (person_id = app.current_person_id() OR staff.may_for_person('staff.read', person_id));

-- migrate:down
DROP FUNCTION staff.set_training_status(uuid, text);
DROP FUNCTION staff.record_training(uuid, text, text, text, date, date, numeric, text);
DROP FUNCTION staff.may_record_for(uuid);
DROP TABLE staff.training;
DELETE FROM meta.state_transition WHERE machine = 'training';
DROP FUNCTION staff.school_year(date);
