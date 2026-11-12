-- migrate:up

-- Approvals (M6.5, ADR 0029): a document version is approved in steps, in
-- order, each by a role (the school's principal, then the CEO, say). A
-- version never changes (documents.version is append-only), so an approved
-- version stays approved; a new version needs its own approval. One person
-- decides at most one step of a request. Readable by whoever may read the
-- document; written only through the functions.

CREATE TABLE documents.approval_request (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  version_id            uuid NOT NULL REFERENCES documents.version (id),
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by_person_id uuid NOT NULL REFERENCES people.person (id),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- At most one request on its way or approved per version; a rejected or
-- withdrawn one stays as history.
CREATE UNIQUE INDEX approval_request_live_idx ON documents.approval_request (version_id)
  WHERE status IN ('pending', 'approved');
CREATE INDEX approval_request_version_idx ON documents.approval_request (version_id, requested_at);
CREATE INDEX approval_request_requested_by_idx ON documents.approval_request (requested_by_person_id);

CREATE TABLE documents.approval_step (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  request_id            uuid NOT NULL REFERENCES documents.approval_request (id),
  step_no               integer NOT NULL CHECK (step_no BETWEEN 1 AND 4),
  role_code             text NOT NULL CHECK (role_code IN ('principal', 'school_admin', 'group_admin', 'group_ceo'))
                          REFERENCES access.role (code),
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  decided_by_person_id  uuid REFERENCES people.person (id),
  decided_at            timestamptz,
  note                  text CHECK (length(note) BETWEEN 1 AND 500),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, step_no),
  CHECK ((status IN ('approved', 'rejected')) = (decided_by_person_id IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX approval_step_decided_by_idx ON documents.approval_step (decided_by_person_id);
CREATE INDEX approval_step_waiting_idx ON documents.approval_step (role_code) WHERE status = 'pending';

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('approval_request', 'pending', 'approved'), ('approval_request', 'pending', 'rejected'),
  ('approval_request', 'pending', 'withdrawn'),
  ('approval_step', 'pending', 'approved'), ('approval_step', 'pending', 'rejected'),
  ('approval_step', 'pending', 'skipped');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON documents.approval_request
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('approval_request');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON documents.approval_step
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('approval_step');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON documents.approval_request FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON documents.approval_step FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON documents.approval_request
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON documents.approval_step
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

-- Does the signed-in person hold the role now: a school role at the school,
-- a group role group-wide?
CREATE FUNCTION documents.holds_role(p_role_code text, p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM access.role_assignment ra
      JOIN access.role r ON r.code = ra.role_code
      JOIN people.person p ON p.id = ra.person_id AND p.status = 'active'
     WHERE ra.person_id = app.current_person_id() AND ra.role_code = p_role_code AND ra.revoked_at IS NULL
       AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
       AND ra.group_id = access.current_group_id()
       AND CASE r.scope_level WHEN 'group' THEN ra.school_id IS NULL ELSE ra.school_id = p_school_id END)
$$;
REVOKE ALL ON FUNCTION documents.holds_role(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.holds_role(text, uuid) TO pyth_api;

-- Asks for the latest version of a document to be approved by these roles, in this order.
CREATE FUNCTION documents.request_approval(p_version_id uuid, p_roles text[]) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  d record;
  v record;
  v_request uuid;
  v_role text;
  v_no integer := 0;
BEGIN
  SELECT * INTO v FROM documents.version WHERE id = p_version_id;
  SELECT * INTO d FROM documents.document WHERE id = v.document_id FOR UPDATE;
  IF NOT FOUND OR NOT documents.may('manage', d.attached_to, d.school_id, d.person_id, d.for_all_staff) THEN
    RAISE EXCEPTION 'no such document' USING ERRCODE = 'P0002';
  END IF;
  IF d.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'the document is archived' USING ERRCODE = 'PY001';
  END IF;
  IF v.version_no <> (SELECT max(version_no) FROM documents.version WHERE document_id = d.id) THEN
    RAISE EXCEPTION 'only the latest version is put up for approval' USING ERRCODE = 'PY001';
  END IF;
  IF coalesce(cardinality(p_roles), 0) NOT BETWEEN 1 AND 4
     OR cardinality(p_roles) <> (SELECT count(DISTINCT r) FROM unnest(p_roles) r) THEN
    RAISE EXCEPTION 'one to four different approvers' USING ERRCODE = '23514';
  END IF;
  IF d.school_id IS NULL AND EXISTS (SELECT 1 FROM unnest(p_roles) r WHERE r IN ('principal', 'school_admin')) THEN
    RAISE EXCEPTION 'a school role approves only a school''s or a pupil''s document' USING ERRCODE = '23514';
  END IF;
  INSERT INTO documents.approval_request (group_id, version_id, requested_by_person_id)
  VALUES (d.group_id, v.id, app.current_person_id())
  RETURNING id INTO v_request;
  FOREACH v_role IN ARRAY p_roles LOOP
    v_no := v_no + 1;
    INSERT INTO documents.approval_step (group_id, request_id, step_no, role_code)
    VALUES (d.group_id, v_request, v_no, v_role);
  END LOOP;
  RETURN v_request;
END $$;
REVOKE ALL ON FUNCTION documents.request_approval(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.request_approval(uuid, text[]) TO pyth_api;

-- The next step, by someone holding its role who has decided no other step of
-- the request. A rejection ends the request; the last approval approves it.
CREATE FUNCTION documents.decide_step(p_step_id uuid, p_decision text, p_note text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  s record;
  q record;
  d record;
  v_outcome text;
BEGIN
  SELECT * INTO s FROM documents.approval_step WHERE id = p_step_id;
  SELECT * INTO q FROM documents.approval_request WHERE id = s.request_id FOR UPDATE;
  SELECT doc.* INTO d FROM documents.version v JOIN documents.document doc ON doc.id = v.document_id WHERE v.id = q.version_id;
  IF NOT FOUND OR NOT documents.holds_role(s.role_code, d.school_id)
     OR NOT documents.may('read', d.attached_to, d.school_id, d.person_id, d.for_all_staff) THEN
    RAISE EXCEPTION 'no such approval waiting for you' USING ERRCODE = 'P0002';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'approve or reject' USING ERRCODE = '23514';
  END IF;
  IF p_decision = 'rejected' AND nullif(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'say why it is rejected' USING ERRCODE = '23514';
  END IF;
  IF q.status <> 'pending' OR s.status <> 'pending' OR d.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'this approval is no longer waiting' USING ERRCODE = 'PY001';
  END IF;
  IF EXISTS (SELECT 1 FROM documents.approval_step e WHERE e.request_id = q.id AND e.step_no < s.step_no AND e.status <> 'approved') THEN
    RAISE EXCEPTION 'an earlier step is still waiting' USING ERRCODE = 'PY001';
  END IF;
  IF EXISTS (SELECT 1 FROM documents.approval_step e WHERE e.request_id = q.id AND e.decided_by_person_id = app.current_person_id()) THEN
    RAISE EXCEPTION 'one person decides one step of a request' USING ERRCODE = 'PY001';
  END IF;
  UPDATE documents.approval_step
     SET status = p_decision, decided_by_person_id = app.current_person_id(), decided_at = now(),
         note = nullif(btrim(p_note), '')
   WHERE id = s.id;
  IF p_decision = 'rejected' THEN
    UPDATE documents.approval_step SET status = 'skipped' WHERE request_id = q.id AND status = 'pending';
    UPDATE documents.approval_request SET status = 'rejected', decided_at = now() WHERE id = q.id;
    v_outcome := 'rejected';
  ELSIF NOT EXISTS (SELECT 1 FROM documents.approval_step WHERE request_id = q.id AND status = 'pending') THEN
    UPDATE documents.approval_request SET status = 'approved', decided_at = now() WHERE id = q.id;
    v_outcome := 'approved';
  ELSE
    v_outcome := 'pending';
  END IF;
  RETURN v_outcome;
END $$;
REVOKE ALL ON FUNCTION documents.decide_step(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.decide_step(uuid, text, text) TO pyth_api;

-- Whoever may manage the document withdraws a request still on its way.
CREATE FUNCTION documents.withdraw_approval(p_request_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  q record;
  d record;
BEGIN
  SELECT * INTO q FROM documents.approval_request WHERE id = p_request_id FOR UPDATE;
  SELECT doc.* INTO d FROM documents.version v JOIN documents.document doc ON doc.id = v.document_id WHERE v.id = q.version_id;
  IF NOT FOUND OR NOT documents.may('manage', d.attached_to, d.school_id, d.person_id, d.for_all_staff) THEN
    RAISE EXCEPTION 'no such approval' USING ERRCODE = 'P0002';
  END IF;
  IF q.status <> 'pending' THEN
    RAISE EXCEPTION 'only a request on its way is withdrawn' USING ERRCODE = 'PY001';
  END IF;
  UPDATE documents.approval_step SET status = 'skipped' WHERE request_id = q.id AND status = 'pending';
  UPDATE documents.approval_request SET status = 'withdrawn', decided_at = now() WHERE id = q.id;
END $$;
REVOKE ALL ON FUNCTION documents.withdraw_approval(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.withdraw_approval(uuid) TO pyth_api;

-- Who decided a step, by name, for anyone who may read the document: an
-- approval is only worth something if its readers see who gave it.
CREATE FUNCTION documents.decided_by_name(p_step_id uuid) RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p.given_name || ' ' || p.family_name
    FROM documents.approval_step s
    JOIN documents.approval_request q ON q.id = s.request_id
    JOIN documents.version v ON v.id = q.version_id
    JOIN documents.document d ON d.id = v.document_id
    JOIN people.person p ON p.id = s.decided_by_person_id
   WHERE s.id = p_step_id AND documents.may('read', d.attached_to, d.school_id, d.person_id, d.for_all_staff)
$$;
REVOKE ALL ON FUNCTION documents.decided_by_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.decided_by_name(uuid) TO pyth_api;

ALTER TABLE documents.approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.approval_step ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON documents.approval_request, documents.approval_step TO pyth_api;
CREATE POLICY read ON documents.approval_request FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM documents.version v WHERE v.id = version_id));
CREATE POLICY read ON documents.approval_step FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM documents.approval_request q WHERE q.id = request_id));

-- migrate:down
DROP FUNCTION documents.decided_by_name(uuid);
DROP FUNCTION documents.withdraw_approval(uuid);
DROP FUNCTION documents.decide_step(uuid, text, text);
DROP FUNCTION documents.request_approval(uuid, text[]);
DROP TABLE documents.approval_step;
DROP TABLE documents.approval_request;
DROP FUNCTION documents.holds_role(text, uuid);
DELETE FROM meta.state_transition WHERE machine IN ('approval_request', 'approval_step');
