-- migrate:up

-- Private documents (M6.4, ADR 0029). Postgres describes each document and
-- version; the bytes live in the object store under keys without personal
-- data. A document belongs to a school, a member of staff or a student; each
-- version is written once and never changed. Downloads only through
-- single-use links that last two minutes, bound to the person who asked,
-- each one written to the access log.

CREATE SCHEMA documents;
REVOKE ALL ON SCHEMA documents FROM PUBLIC;
GRANT USAGE ON SCHEMA documents TO pyth_api;

INSERT INTO access.permission (code, description) VALUES
  ('documents.read', 'Read the school''s documents and its students'' documents'),
  ('documents.manage', 'Upload and archive the school''s documents and its students'' documents');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('group_ceo', 'documents.read'), ('group_admin', 'documents.read'), ('principal', 'documents.read'),
  ('school_admin', 'documents.read'),
  ('group_admin', 'documents.manage'), ('principal', 'documents.manage'), ('school_admin', 'documents.manage');

CREATE TABLE documents.document (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  attached_to           text NOT NULL CHECK (attached_to IN ('school', 'staff', 'student')),
  -- The school for a school's or a student's document; none for staff, whose
  -- documents follow them where they work (ADR 0028).
  school_id             uuid,
  person_id             uuid,
  title                 text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  category              text NOT NULL CHECK (category IN ('policy', 'plan', 'contract', 'certificate', 'report', 'letter', 'other')),
  -- A school's document every member of its staff may read (a policy, say).
  for_all_staff         boolean NOT NULL DEFAULT false,
  created_by_person_id  uuid REFERENCES people.person (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz,
  UNIQUE (id, group_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  FOREIGN KEY (person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK ((attached_to = 'school' AND school_id IS NOT NULL AND person_id IS NULL)
      OR (attached_to = 'staff' AND school_id IS NULL AND person_id IS NOT NULL)
      OR (attached_to = 'student' AND school_id IS NOT NULL AND person_id IS NOT NULL)),
  CHECK (NOT for_all_staff OR attached_to = 'school')
);
CREATE INDEX document_school_idx ON documents.document (school_id) WHERE school_id IS NOT NULL;
CREATE INDEX document_person_idx ON documents.document (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX document_created_by_idx ON documents.document (created_by_person_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON documents.document FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON documents.document
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

CREATE TABLE documents.version (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id               uuid NOT NULL,
  document_id            uuid NOT NULL,
  version_no             integer NOT NULL CHECK (version_no >= 1),
  object_key             text NOT NULL UNIQUE CHECK (object_key ~ '^v1/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  file_name              text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200 AND file_name !~ '[/\\[:cntrl:]]'),
  content_type           text NOT NULL CHECK (content_type IN (
                           'application/pdf', 'image/png', 'image/jpeg', 'text/plain',
                           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                           'application/vnd.oasis.opendocument.text',
                           'application/vnd.oasis.opendocument.spreadsheet')),
  size_bytes             bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256                 bytea NOT NULL CHECK (length(sha256) = 32),
  uploaded_by_person_id  uuid NOT NULL REFERENCES people.person (id),
  uploaded_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no),
  FOREIGN KEY (document_id, group_id) REFERENCES documents.document (id, group_id)
);
CREATE INDEX version_uploaded_by_idx ON documents.version (uploaded_by_person_id);
-- A version never changes: a new file is a new version.
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON documents.version
  FOR EACH ROW EXECUTE FUNCTION scheduling.append_only();
CREATE TRIGGER audit AFTER INSERT ON documents.version FOR EACH ROW EXECUTE FUNCTION audit.log_change();

-- Only the token's SHA-256 is kept. Read and written through the functions only.
CREATE TABLE documents.download_link (
  token_hash  bytea PRIMARY KEY CHECK (length(token_hash) = 32),
  version_id  uuid NOT NULL REFERENCES documents.version (id),
  person_id   uuid NOT NULL REFERENCES people.person (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '2 minutes')
);
CREATE INDEX download_link_version_idx ON documents.download_link (version_id);
CREATE INDEX download_link_person_idx ON documents.download_link (person_id, created_at);
REVOKE ALL ON documents.download_link FROM PUBLIC;

-- May the signed-in person read, or manage, a document like this?
CREATE FUNCTION documents.may(p_action text, p_attached_to text, p_school_id uuid, p_person_id uuid, p_for_all_staff boolean)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL AND CASE
    WHEN p_attached_to = 'staff' THEN
      CASE p_action WHEN 'read' THEN p_person_id = app.current_person_id() OR staff.may_for_person('staff.read', p_person_id)
                    ELSE staff.may_for_person('staff.manage', p_person_id) END
    WHEN p_action = 'read' THEN
      access.has_permission('documents.read', p_school_id)
      OR (p_attached_to = 'school' AND p_for_all_staff AND EXISTS (
            SELECT 1 FROM access.role_assignment ra
             WHERE ra.person_id = app.current_person_id() AND ra.school_id = p_school_id AND ra.revoked_at IS NULL
               AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())))
    ELSE access.has_permission('documents.manage', p_school_id) END
$$;
REVOKE ALL ON FUNCTION documents.may(text, text, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.may(text, text, uuid, uuid, boolean) TO pyth_api;

CREATE FUNCTION documents.create_document(
  p_attached_to text, p_school_id uuid, p_person_id uuid, p_title text, p_category text, p_for_all_staff boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT coalesce(documents.may('manage', p_attached_to, p_school_id, p_person_id, p_for_all_staff), false) THEN
    RAISE EXCEPTION 'not yours to file' USING ERRCODE = 'P0002';
  END IF;
  -- A student's document is filed by a school where the student is enrolled.
  IF p_attached_to = 'student' AND NOT EXISTS (
       SELECT 1 FROM people.enrolment e
        WHERE e.student_person_id = p_person_id AND e.school_id = p_school_id AND e.status IN ('active', 'suspended')
          AND (e.end_date IS NULL OR e.end_date > current_date)) THEN
    RAISE EXCEPTION 'no such student at the school' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO documents.document (group_id, attached_to, school_id, person_id, title, category, for_all_staff, created_by_person_id)
  VALUES (access.current_group_id(), p_attached_to, p_school_id, p_person_id, btrim(p_title), p_category,
          coalesce(p_for_all_staff, false), app.current_person_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION documents.create_document(text, uuid, uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.create_document(text, uuid, uuid, text, text, boolean) TO pyth_api;

-- The next version of a document. The API uploads the object under the key
-- returned, in the same transaction: a failed upload leaves no row.
CREATE FUNCTION documents.add_version(
  p_document_id uuid, p_file_name text, p_content_type text, p_size_bytes bigint, p_sha256 bytea,
  OUT version_id uuid, OUT version_no integer, OUT object_key text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  d record;
BEGIN
  SELECT * INTO d FROM documents.document WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR NOT documents.may('manage', d.attached_to, d.school_id, d.person_id, d.for_all_staff) THEN
    RAISE EXCEPTION 'no such document' USING ERRCODE = 'P0002';
  END IF;
  IF d.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'the document is archived' USING ERRCODE = 'PY001';
  END IF;
  version_id := uuidv7();
  object_key := format('v1/%s/%s', d.id, version_id);
  SELECT coalesce(max(v.version_no), 0) + 1 INTO version_no FROM documents.version v WHERE v.document_id = d.id;
  INSERT INTO documents.version (id, group_id, document_id, version_no, object_key, file_name, content_type,
                                 size_bytes, sha256, uploaded_by_person_id)
  VALUES (version_id, d.group_id, d.id, version_no, object_key, p_file_name, p_content_type, p_size_bytes, p_sha256,
          app.current_person_id());
  UPDATE documents.document SET updated_at = now() WHERE id = d.id;
END $$;
REVOKE ALL ON FUNCTION documents.add_version(uuid, text, text, bigint, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.add_version(uuid, text, text, bigint, bytea) TO pyth_api;

CREATE FUNCTION documents.archive_document(p_document_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  d record;
BEGIN
  SELECT * INTO d FROM documents.document WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR NOT documents.may('manage', d.attached_to, d.school_id, d.person_id, d.for_all_staff) THEN
    RAISE EXCEPTION 'no such document' USING ERRCODE = 'P0002';
  END IF;
  IF d.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'the document is already archived' USING ERRCODE = 'PY001';
  END IF;
  UPDATE documents.document SET archived_at = now() WHERE id = d.id;
END $$;
REVOKE ALL ON FUNCTION documents.archive_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.archive_document(uuid) TO pyth_api;

-- A link for the signed-in person to download a version they may read, valid
-- for two minutes. The API makes the token and passes only its SHA-256.
CREATE FUNCTION documents.issue_link(p_version_id uuid, p_token_hash bytea) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  d record;
  v_expires timestamptz := now() + interval '2 minutes';
BEGIN
  SELECT doc.* INTO d FROM documents.version v JOIN documents.document doc ON doc.id = v.document_id WHERE v.id = p_version_id;
  IF NOT FOUND OR NOT documents.may('read', d.attached_to, d.school_id, d.person_id, d.for_all_staff) THEN
    RAISE EXCEPTION 'no such document' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO documents.download_link (token_hash, version_id, person_id, expires_at)
  VALUES (p_token_hash, p_version_id, app.current_person_id(), v_expires);
  RETURN v_expires;
END $$;
REVOKE ALL ON FUNCTION documents.issue_link(uuid, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.issue_link(uuid, bytea) TO pyth_api;

-- Redeems a link once, for the person it was issued to, if they still may
-- read the document; the download is written to the access log.
CREATE FUNCTION documents.redeem_link(p_token_hash bytea)
RETURNS TABLE (version_id uuid, object_key text, file_name text, content_type text, size_bytes bigint, sha256 bytea)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  l record;
  d record;
  v record;
BEGIN
  SELECT * INTO l FROM documents.download_link dl WHERE dl.token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR l.person_id IS DISTINCT FROM app.current_person_id() OR l.used_at IS NOT NULL OR l.expires_at <= now() THEN
    RAISE EXCEPTION 'the link has expired or been used' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v FROM documents.version dv WHERE dv.id = l.version_id;
  SELECT * INTO d FROM documents.document doc WHERE doc.id = v.document_id;
  IF NOT documents.may('read', d.attached_to, d.school_id, d.person_id, d.for_all_staff) THEN
    RAISE EXCEPTION 'the link has expired or been used' USING ERRCODE = 'P0002';
  END IF;
  UPDATE documents.download_link dl SET used_at = now() WHERE dl.token_hash = p_token_hash;
  INSERT INTO audit.access_log (actor_person_id, action, resource, subject_person_id, school_id, record_count, request_id)
  VALUES (app.current_person_id(), 'download', 'documents.version:' || d.attached_to, d.person_id, d.school_id, 1,
          app.current_request_id());
  RETURN QUERY SELECT v.id, v.object_key, v.file_name, v.content_type, v.size_bytes, v.sha256;
END $$;
REVOKE ALL ON FUNCTION documents.redeem_link(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION documents.redeem_link(bytea) TO pyth_api;

ALTER TABLE documents.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.version ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents.download_link ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON documents.document, documents.version TO pyth_api;
CREATE POLICY read ON documents.document FOR SELECT TO pyth_api
  USING (documents.may('read', attached_to, school_id, person_id, for_all_staff));
CREATE POLICY read ON documents.version FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM documents.document d WHERE d.id = document_id));

-- migrate:down
DROP FUNCTION documents.redeem_link(bytea);
DROP FUNCTION documents.issue_link(uuid, bytea);
DROP FUNCTION documents.archive_document(uuid);
DROP FUNCTION documents.add_version(uuid, text, text, bigint, bytea);
DROP FUNCTION documents.create_document(text, uuid, uuid, text, text, boolean);
DROP TABLE documents.download_link;
DROP TABLE documents.version;
DROP TABLE documents.document;
DROP FUNCTION documents.may(text, text, uuid, uuid, boolean);
DELETE FROM access.role_permission WHERE permission_code IN ('documents.read', 'documents.manage');
DELETE FROM access.permission WHERE code IN ('documents.read', 'documents.manage');
DROP SCHEMA documents;
