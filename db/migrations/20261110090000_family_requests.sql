-- migrate:up

-- Parent requests to School Life (M4.7): a guardian writes to the school about
-- a child (an absence, a dietary change, who collects them, a question);
-- School Life and the school's leaders answer. Requests go to the school the
-- child is enrolled at, and only staff who handle requests there see them.
-- Every write goes through the functions below, which decide who may do what;
-- row-level security decides who reads.

INSERT INTO access.permission (code, description) VALUES
  ('requests.manage', 'Read and answer families'' requests to the school');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('school_life_coordinator', 'requests.manage'), ('principal', 'requests.manage'), ('school_admin', 'requests.manage');

CREATE TABLE people.family_request (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id               uuid NOT NULL,
  school_id              uuid NOT NULL,
  student_person_id      uuid NOT NULL,
  requested_by_person_id uuid NOT NULL,
  kind                   text NOT NULL CHECK (kind IN ('absence', 'dietary', 'collection', 'question', 'other')),
  subject                text NOT NULL CHECK (length(subject) BETWEEN 1 AND 200),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'answered', 'closed')),
  last_message_at        timestamptz NOT NULL DEFAULT now(),
  closed_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (requested_by_person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX family_request_school_idx ON people.family_request (school_id, status, last_message_at);
CREATE INDEX family_request_student_idx ON people.family_request (student_person_id);
CREATE INDEX family_request_requested_by_idx ON people.family_request (requested_by_person_id);

CREATE TABLE people.family_request_message (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id          uuid NOT NULL REFERENCES org.education_group (id),
  request_id        uuid NOT NULL REFERENCES people.family_request (id),
  author_person_id  uuid NOT NULL REFERENCES people.person (id),
  from_school       boolean NOT NULL,
  body              text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX family_request_message_request_idx ON people.family_request_message (request_id, created_at);
CREATE INDEX family_request_message_author_idx ON people.family_request_message (author_person_id);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON people.family_request_message
  FOR EACH ROW EXECUTE FUNCTION scheduling.append_only();

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('family_request', 'open', 'in_progress'), ('family_request', 'open', 'answered'), ('family_request', 'open', 'closed'),
  ('family_request', 'in_progress', 'answered'), ('family_request', 'in_progress', 'closed'),
  ('family_request', 'answered', 'open'), ('family_request', 'answered', 'closed');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON people.family_request
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('family_request');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON people.family_request FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
-- Requests can say why a child is absent or what they may not eat: never in the audit log.
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON people.family_request
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('subject');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON people.family_request_message
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('body');

-- A guardian opens a request about their child, to a school the child attends now.
CREATE FUNCTION people.open_family_request(
  p_student_id uuid, p_school_id uuid, p_kind text, p_subject text, p_body text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
  request uuid;
  grp uuid;
BEGIN
  IF me IS NULL OR NOT access.is_guardian_of(p_student_id, 'view') THEN
    RAISE EXCEPTION 'no such child' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM people.enrolment e
                  WHERE e.student_person_id = p_student_id AND e.school_id = p_school_id AND e.status = 'active'
                    AND e.start_date <= current_date AND (e.end_date IS NULL OR e.end_date > current_date)) THEN
    RAISE EXCEPTION 'the child does not attend this school' USING ERRCODE = '23503';
  END IF;
  SELECT group_id INTO grp FROM people.person WHERE id = p_student_id;
  INSERT INTO people.family_request (group_id, school_id, student_person_id, requested_by_person_id, kind, subject)
  VALUES (grp, p_school_id, p_student_id, me, p_kind, p_subject)
  RETURNING id INTO request;
  INSERT INTO people.family_request_message (group_id, request_id, author_person_id, from_school, body)
  VALUES (grp, request, me, false, p_body);
  RETURN request;
END $$;
REVOKE ALL ON FUNCTION people.open_family_request(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.open_family_request(uuid, uuid, text, text, text) TO pyth_api;

-- A message on a request: from the school it answers; from the family it reopens an answered one.
CREATE FUNCTION people.reply_to_family_request(p_request_id uuid, p_body text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
  r record;
  staff boolean;
  family boolean;
  next_status text;
BEGIN
  SELECT * INTO r FROM people.family_request WHERE id = p_request_id FOR UPDATE;
  IF me IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = 'P0002';
  END IF;
  staff := access.has_permission('requests.manage', r.school_id);
  family := access.is_guardian_of(r.student_person_id, 'view');
  IF NOT staff AND NOT family THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = 'P0002';
  END IF;
  IF r.status = 'closed' THEN
    RAISE EXCEPTION 'the request is closed; open a new one' USING ERRCODE = 'PY001';
  END IF;
  next_status := CASE WHEN staff THEN 'answered' WHEN r.status = 'answered' THEN 'open' ELSE r.status END;
  INSERT INTO people.family_request_message (group_id, request_id, author_person_id, from_school, body)
  VALUES (r.group_id, r.id, me, staff, p_body);
  UPDATE people.family_request SET status = next_status, last_message_at = now() WHERE id = r.id;
  RETURN next_status;
END $$;
REVOKE ALL ON FUNCTION people.reply_to_family_request(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.reply_to_family_request(uuid, text) TO pyth_api;

-- Staff mark a request as being worked on or close it; the family can close their own.
CREATE FUNCTION people.set_family_request_status(p_request_id uuid, p_status text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
  r record;
  staff boolean;
BEGIN
  SELECT * INTO r FROM people.family_request WHERE id = p_request_id FOR UPDATE;
  IF me IS NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = 'P0002';
  END IF;
  staff := access.has_permission('requests.manage', r.school_id);
  IF NOT staff AND NOT access.is_guardian_of(r.student_person_id, 'view') THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = 'P0002';
  END IF;
  IF p_status NOT IN ('in_progress', 'closed') OR (p_status = 'in_progress' AND NOT staff) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  -- Transitions are checked by the state machine (PY001).
  UPDATE people.family_request
     SET status = p_status, closed_at = CASE WHEN p_status = 'closed' THEN now() END
   WHERE id = r.id;
  RETURN p_status;
END $$;
REVOKE ALL ON FUNCTION people.set_family_request_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION people.set_family_request_status(uuid, text) TO pyth_api;

ALTER TABLE people.family_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE people.family_request_message ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON people.family_request, people.family_request_message TO pyth_api;
-- The child's guardians, and the school's staff who handle requests. Nobody else, not the CEO.
CREATE POLICY read ON people.family_request FOR SELECT TO pyth_api
  USING (access.is_guardian_of(student_person_id, 'view') OR access.has_permission('requests.manage', school_id));
CREATE POLICY read ON people.family_request_message FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM people.family_request r WHERE r.id = request_id));

-- migrate:down
DROP FUNCTION people.set_family_request_status(uuid, text);
DROP FUNCTION people.reply_to_family_request(uuid, text);
DROP FUNCTION people.open_family_request(uuid, uuid, text, text, text);
DROP TABLE people.family_request_message;
DROP TABLE people.family_request;
DELETE FROM meta.state_transition WHERE machine = 'family_request';
DELETE FROM access.role_permission WHERE permission_code = 'requests.manage';
DELETE FROM access.permission WHERE code = 'requests.manage';
