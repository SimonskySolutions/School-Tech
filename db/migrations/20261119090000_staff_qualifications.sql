-- migrate:up

-- Qualifications and checks (M6.2, ADR 0028). A qualification belongs to the
-- person (a teaching licence, a degree, first aid): title, issuer, dates.
-- A criminal record check is data about convictions (GDPR Art. 10), so only
-- the fact is kept: a certificate allowing the work was seen, on a day, valid
-- until a day, by whom. Never its content, an outcome or a copy. Both are
-- read by the person and by the leaders of a school where they work now.

CREATE TABLE staff.qualification (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  person_id             uuid NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('teaching_licence', 'degree', 'first_aid', 'food_hygiene', 'safeguarding', 'other')),
  title                 text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  issuer                text CHECK (length(issuer) BETWEEN 1 AND 200),
  awarded_on            date NOT NULL,
  expires_on            date,
  withdrawn_at          timestamptz,
  recorded_by_person_id uuid REFERENCES people.person (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (expires_on IS NULL OR expires_on > awarded_on)
);
CREATE INDEX qualification_person_idx ON staff.qualification (person_id) WHERE withdrawn_at IS NULL;
CREATE INDEX qualification_recorded_by_idx ON staff.qualification (recorded_by_person_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON staff.qualification FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON staff.qualification
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

CREATE TABLE staff.record_check (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id           uuid NOT NULL,
  person_id          uuid NOT NULL,
  seen_on            date NOT NULL,
  valid_until        date NOT NULL,
  seen_by_person_id  uuid NOT NULL REFERENCES people.person (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (valid_until > seen_on)
);
CREATE INDEX record_check_person_idx ON staff.record_check (person_id, valid_until);
CREATE INDEX record_check_seen_by_idx ON staff.record_check (seen_by_person_id);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON staff.record_check
  FOR EACH ROW EXECUTE FUNCTION scheduling.append_only();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON staff.record_check
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

-- The schools where someone works now: a current employment or a live role.
CREATE FUNCTION staff.current_schools(p_person_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT e.school_id FROM staff.employment e
   WHERE e.person_id = p_person_id AND e.school_id IS NOT NULL
     AND e.start_date <= current_date AND (e.end_date IS NULL OR e.end_date >= current_date)
  UNION
  SELECT ra.school_id FROM access.role_assignment ra
   WHERE ra.person_id = p_person_id AND ra.school_id IS NOT NULL AND ra.revoked_at IS NULL
     AND (ra.valid_until IS NULL OR ra.valid_until > now())
$$;
REVOKE ALL ON FUNCTION staff.current_schools(uuid) FROM PUBLIC;

-- Whether the caller holds the permission at a school where the person works
-- now, or at group level for someone who works in the group now (at a school,
-- or group-wide). Never for parents or children.
CREATE FUNCTION staff.may_for_person(p_permission text, p_person_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM staff.current_schools(p_person_id) s (school_id)
             WHERE access.has_permission(p_permission, s.school_id))
    OR (access.has_permission(p_permission) AND (
          EXISTS (SELECT 1 FROM staff.current_schools(p_person_id))
          OR EXISTS (SELECT 1 FROM staff.employment e
                      WHERE e.person_id = p_person_id AND e.school_id IS NULL AND e.group_id = access.current_group_id()
                        AND e.start_date <= current_date AND (e.end_date IS NULL OR e.end_date >= current_date))
          OR EXISTS (SELECT 1 FROM access.role_assignment ra
                      WHERE ra.person_id = p_person_id AND ra.school_id IS NULL AND ra.revoked_at IS NULL
                        AND ra.group_id = access.current_group_id()))))
$$;
REVOKE ALL ON FUNCTION staff.may_for_person(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.may_for_person(text, uuid) TO pyth_api;

CREATE FUNCTION staff.record_qualification(
  p_person_id uuid, p_kind text, p_title text, p_issuer text, p_awarded_on date, p_expires_on date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  qualification uuid;
BEGIN
  IF NOT staff.may_for_person('staff.manage', p_person_id) THEN
    RAISE EXCEPTION 'no such member of staff at your schools' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO staff.qualification (group_id, person_id, kind, title, issuer, awarded_on, expires_on, recorded_by_person_id)
  VALUES (access.current_group_id(), p_person_id, p_kind, btrim(p_title), nullif(btrim(p_issuer), ''), p_awarded_on,
          p_expires_on, app.current_person_id())
  RETURNING id INTO qualification;
  RETURN qualification;
END $$;
REVOKE ALL ON FUNCTION staff.record_qualification(uuid, text, text, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.record_qualification(uuid, text, text, text, date, date) TO pyth_api;

-- A qualification recorded in error is withdrawn, not deleted.
CREATE FUNCTION staff.withdraw_qualification(p_qualification_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  q record;
BEGIN
  SELECT * INTO q FROM staff.qualification WHERE id = p_qualification_id FOR UPDATE;
  IF NOT FOUND OR NOT staff.may_for_person('staff.manage', q.person_id) THEN
    RAISE EXCEPTION 'no such qualification' USING ERRCODE = 'P0002';
  END IF;
  IF q.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'the qualification is already withdrawn' USING ERRCODE = 'PY001';
  END IF;
  UPDATE staff.qualification SET withdrawn_at = now() WHERE id = q.id;
END $$;
REVOKE ALL ON FUNCTION staff.withdraw_qualification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.withdraw_qualification(uuid) TO pyth_api;

-- A satisfactory certificate was seen. Not in the future; valid for a year at most.
CREATE FUNCTION staff.record_check(p_person_id uuid, p_seen_on date, p_valid_until date) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  check_id uuid;
BEGIN
  IF NOT staff.may_for_person('staff.manage', p_person_id) THEN
    RAISE EXCEPTION 'no such member of staff at your schools' USING ERRCODE = 'P0002';
  END IF;
  IF p_seen_on > current_date OR p_valid_until > p_seen_on + 366 THEN
    RAISE EXCEPTION 'a certificate is seen today or before, and valid for a year at most' USING ERRCODE = '23514';
  END IF;
  INSERT INTO staff.record_check (group_id, person_id, seen_on, valid_until, seen_by_person_id)
  VALUES (access.current_group_id(), p_person_id, p_seen_on, p_valid_until, app.current_person_id())
  RETURNING id INTO check_id;
  RETURN check_id;
END $$;
REVOKE ALL ON FUNCTION staff.record_check(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION staff.record_check(uuid, date, date) TO pyth_api;

ALTER TABLE staff.qualification ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff.record_check ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON staff.qualification, staff.record_check TO pyth_api;
CREATE POLICY read ON staff.qualification FOR SELECT TO pyth_api
  USING (person_id = app.current_person_id() OR staff.may_for_person('staff.read', person_id));
CREATE POLICY read ON staff.record_check FOR SELECT TO pyth_api
  USING (person_id = app.current_person_id() OR staff.may_for_person('staff.read', person_id));

-- migrate:down
DROP FUNCTION staff.record_check(uuid, date, date);
DROP FUNCTION staff.withdraw_qualification(uuid);
DROP FUNCTION staff.record_qualification(uuid, text, text, text, date, date);
DROP TABLE staff.record_check;
DROP TABLE staff.qualification;
DROP FUNCTION staff.may_for_person(text, uuid);
DROP FUNCTION staff.current_schools(uuid);
