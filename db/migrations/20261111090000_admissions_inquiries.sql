-- migrate:up

-- Admissions (M5, ADR 0026). M5.1: inquiries sent from a school's website.
-- Prospective families are not persons until they enrol: an inquiry keeps the
-- contact details it was sent with and creates no person, login or guardian
-- relationship. Only the school's admissions staff read it. Every write goes
-- through the functions below; row-level security decides who reads.

CREATE SCHEMA admissions;
COMMENT ON SCHEMA admissions IS 'Prospective families: inquiries, applications, offers (ADR 0026). Personal data without a person record.';
REVOKE ALL ON SCHEMA admissions FROM PUBLIC;
GRANT USAGE ON SCHEMA admissions TO pyth_api, pyth_worker;

INSERT INTO access.permission (code, description) VALUES
  ('admissions.manage', 'Read and work on inquiries and applications at the school');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('principal', 'admissions.manage'), ('school_admin', 'admissions.manage'), ('group_admin', 'admissions.manage');

-- The admissions privacy notice the website form shows, numbered per group.
-- A published version never changes; a new text is a new version.
CREATE TABLE admissions.privacy_notice (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id               uuid NOT NULL REFERENCES org.education_group (id),
  version                integer NOT NULL CHECK (version > 0),
  notice_text            text NOT NULL CHECK (length(notice_text) BETWEEN 50 AND 20000),
  news_consent_text      text NOT NULL CHECK (length(news_consent_text) BETWEEN 10 AND 1000),
  published_by_person_id uuid REFERENCES people.person (id),
  published_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, version)
);
CREATE INDEX privacy_notice_published_by_idx ON admissions.privacy_notice (published_by_person_id);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON admissions.privacy_notice
  FOR EACH ROW EXECUTE FUNCTION scheduling.append_only();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON admissions.privacy_notice
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

-- What a family sent. Contact fields become NULL when the inquiry is erased
-- (M5.6); the row stays so admissions can still be counted.
CREATE TABLE admissions.inquiry (
  id                         uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id                   uuid NOT NULL,
  school_id                  uuid NOT NULL,
  website_id                 uuid NOT NULL REFERENCES org.website (id),
  notice_id                  uuid NOT NULL REFERENCES admissions.privacy_notice (id),
  parent_name                text CHECK (length(parent_name) BETWEEN 1 AND 200),
  email                      text CHECK (length(email) <= 254 AND email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                      text CHECK (phone ~ '^\+?[0-9 ()-]{6,20}$'),
  child_name                 text CHECK (length(child_name) BETWEEN 1 AND 100),
  birth_year                 smallint CHECK (birth_year BETWEEN 2000 AND 2100),
  grade_of_interest          text CHECK (length(grade_of_interest) BETWEEN 1 AND 20),
  intended_start             text CHECK (length(intended_start) BETWEEN 1 AND 40),
  message                    text CHECK (length(message) BETWEEN 1 AND 2000),
  news_consent_at            timestamptz,
  news_consent_withdrawn_at  timestamptz,
  status                     text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  outcome                    text CHECK (outcome IN ('applied', 'not_interested', 'no_response', 'not_eligible', 'duplicate')),
  closed_at                  timestamptz,
  erased_at                  timestamptz,
  received_at                timestamptz NOT NULL DEFAULT now(),
  last_activity_at           timestamptz NOT NULL DEFAULT now(),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK ((status = 'closed') = (outcome IS NOT NULL)),
  CHECK (news_consent_withdrawn_at IS NULL OR news_consent_at IS NOT NULL),
  CHECK (CASE WHEN erased_at IS NULL THEN parent_name IS NOT NULL AND email IS NOT NULL
              ELSE status = 'closed' AND parent_name IS NULL AND email IS NULL AND phone IS NULL
                   AND child_name IS NULL AND message IS NULL END)
);
CREATE INDEX inquiry_school_idx ON admissions.inquiry (school_id, status, last_activity_at);
CREATE INDEX inquiry_website_received_idx ON admissions.inquiry (website_id, received_at);
CREATE INDEX inquiry_notice_idx ON admissions.inquiry (notice_id);
-- One open inquiry per address and school: a second form is added to it.
CREATE UNIQUE INDEX inquiry_open_email_key ON admissions.inquiry (school_id, email) WHERE status <> 'closed';

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('inquiry', 'new', 'contacted'), ('inquiry', 'new', 'closed'), ('inquiry', 'contacted', 'closed');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON admissions.inquiry
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('inquiry');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON admissions.inquiry FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
-- Names, contact details and what families write never reach the audit log.
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON admissions.inquiry
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('parent_name', 'email', 'phone', 'child_name', 'message');

-- The contact log: staff notes, calls, e-mails and meetings, and later forms
-- from the same family. Permanent, except that erasure empties the text.
CREATE TABLE admissions.inquiry_note (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id         uuid NOT NULL REFERENCES org.education_group (id),
  inquiry_id       uuid NOT NULL REFERENCES admissions.inquiry (id),
  author_person_id uuid REFERENCES people.person (id),
  kind             text NOT NULL CHECK (kind IN ('note', 'call', 'email', 'meeting', 'family_message')),
  body             text CHECK (length(body) BETWEEN 1 AND 2000),
  erased_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'family_message') = (author_person_id IS NULL)),
  CHECK ((erased_at IS NULL) = (body IS NOT NULL))
);
CREATE INDEX inquiry_note_inquiry_idx ON admissions.inquiry_note (inquiry_id, created_at);
CREATE INDEX inquiry_note_author_idx ON admissions.inquiry_note (author_person_id);

CREATE FUNCTION admissions.protect_note() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  -- The only change a note allows is erasing its text.
  IF TG_OP = 'UPDATE' AND OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL AND NEW.body IS NULL
     AND (NEW.id, NEW.group_id, NEW.inquiry_id, NEW.author_person_id, NEW.kind, NEW.created_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.group_id, OLD.inquiry_id, OLD.author_person_id, OLD.kind, OLD.created_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'admissions.inquiry_note rows are permanent' USING ERRCODE = 'PY004';
END $$;
REVOKE ALL ON FUNCTION admissions.protect_note() FROM PUBLIC;
CREATE TRIGGER protect_note BEFORE UPDATE OR DELETE ON admissions.inquiry_note
  FOR EACH ROW EXECUTE FUNCTION admissions.protect_note();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON admissions.inquiry_note
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('body');

-- The privacy officer publishes a new version of the notice.
CREATE FUNCTION admissions.publish_privacy_notice(p_notice_text text, p_news_consent_text text) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  grp constant uuid := access.current_group_id();
  next_version integer;
BEGIN
  IF grp IS NULL OR NOT access.has_permission('privacy.manage') THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('admissions.privacy_notice'), hashtext(grp::text));
  SELECT coalesce(max(version), 0) + 1 INTO next_version FROM admissions.privacy_notice WHERE group_id = grp;
  INSERT INTO admissions.privacy_notice (group_id, version, notice_text, news_consent_text, published_by_person_id)
  VALUES (grp, next_version, p_notice_text, p_news_consent_text, app.current_person_id());
  RETURN next_version;
END $$;
REVOKE ALL ON FUNCTION admissions.publish_privacy_notice(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.publish_privacy_notice(text, text) TO pyth_api;

-- What the public form on a website needs: the schools it serves and the
-- current notice. Nothing about any family.
CREATE FUNCTION admissions.inquiry_form(p_hostname text)
RETURNS TABLE (school_id uuid, school_name text, notice_id uuid, notice_version integer, notice_text text, news_consent_text text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT s.id, s.name, n.id, n.version, n.notice_text, n.news_consent_text
    FROM org.resolve_hostname(p_hostname) r
    JOIN org.website_school ws ON ws.website_id = r.website_id
    JOIN org.school s ON s.id = ws.school_id AND s.status = 'active'
    JOIN LATERAL (SELECT * FROM admissions.privacy_notice pn WHERE pn.group_id = r.group_id
                   ORDER BY pn.version DESC LIMIT 1) n ON true
   ORDER BY ws.is_primary_website_for_school DESC, s.name
$$;
REVOKE ALL ON FUNCTION admissions.inquiry_form(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.inquiry_form(text) TO pyth_api;

-- A family sends the form on a website. No person context: the website has
-- no sign-in. Returns nothing, so the answer is the same whether the inquiry
-- is new or added to the open one from the same address (ADR 0026).
CREATE FUNCTION admissions.submit_inquiry(
  p_hostname text, p_school_id uuid, p_notice_id uuid,
  p_parent_name text, p_email text, p_phone text, p_child_name text, p_birth_year smallint,
  p_grade_of_interest text, p_intended_start text, p_message text, p_news_consent boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  site record;
  grp uuid;
  current_notice uuid;
  address constant text := lower(btrim(p_email));
  open_id uuid;
BEGIN
  SELECT r.website_id, r.group_id INTO site
    FROM org.resolve_hostname(p_hostname) r
    JOIN org.website_school ws ON ws.website_id = r.website_id AND ws.school_id = p_school_id
    JOIN org.school s ON s.id = ws.school_id AND s.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such school on this website' USING ERRCODE = 'P0002';
  END IF;
  grp := site.group_id;
  SELECT id INTO current_notice FROM admissions.privacy_notice WHERE group_id = grp ORDER BY version DESC LIMIT 1;
  IF current_notice IS DISTINCT FROM p_notice_id THEN
    RAISE EXCEPTION 'the privacy notice has changed; please read it again' USING ERRCODE = 'PY020';
  END IF;
  -- One website at a time, so the cap below cannot be passed by sending in parallel.
  PERFORM pg_advisory_xact_lock(hashtext('admissions.inquiry'), hashtext(site.website_id::text));
  IF (SELECT count(*) FROM admissions.inquiry
       WHERE website_id = site.website_id AND received_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'too many inquiries from this website just now; please try again later' USING ERRCODE = 'PY021';
  END IF;

  SELECT id INTO open_id FROM admissions.inquiry
   WHERE school_id = p_school_id AND email = address AND status <> 'closed'
   FOR UPDATE;
  IF FOUND THEN
    INSERT INTO admissions.inquiry_note (group_id, inquiry_id, kind, body)
    VALUES (grp, open_id, 'family_message', coalesce(nullif(btrim(p_message), ''), 'Sent the inquiry form again.'));
    UPDATE admissions.inquiry
       SET last_activity_at = now(),
           news_consent_at = CASE WHEN p_news_consent AND (news_consent_at IS NULL OR news_consent_withdrawn_at IS NOT NULL)
                                  THEN now() ELSE news_consent_at END,
           news_consent_withdrawn_at = CASE WHEN p_news_consent THEN NULL ELSE news_consent_withdrawn_at END
     WHERE id = open_id;
    RETURN;
  END IF;

  INSERT INTO admissions.inquiry (group_id, school_id, website_id, notice_id, parent_name, email, phone, child_name,
                                  birth_year, grade_of_interest, intended_start, message, news_consent_at)
  VALUES (grp, p_school_id, site.website_id, p_notice_id, btrim(p_parent_name), address, nullif(btrim(p_phone), ''),
          nullif(btrim(p_child_name), ''), p_birth_year, nullif(btrim(p_grade_of_interest), ''),
          nullif(btrim(p_intended_start), ''), nullif(btrim(p_message), ''),
          CASE WHEN p_news_consent THEN now() END);
END $$;
REVOKE ALL ON FUNCTION admissions.submit_inquiry(text, uuid, uuid, text, text, text, text, smallint, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.submit_inquiry(text, uuid, uuid, text, text, text, text, smallint, text, text, text, boolean) TO pyth_api;

-- Staff record a contact or a note; a call, e-mail or meeting marks a new inquiry contacted.
CREATE FUNCTION admissions.add_inquiry_note(p_inquiry_id uuid, p_kind text, p_body text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  me constant uuid := app.current_person_id();
  r record;
  next_status text;
BEGIN
  SELECT * INTO r FROM admissions.inquiry WHERE id = p_inquiry_id FOR UPDATE;
  IF me IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', r.school_id) THEN
    RAISE EXCEPTION 'no such inquiry' USING ERRCODE = 'P0002';
  END IF;
  IF r.status = 'closed' THEN
    RAISE EXCEPTION 'the inquiry is closed' USING ERRCODE = 'PY001';
  END IF;
  IF p_kind NOT IN ('note', 'call', 'email', 'meeting') THEN
    RAISE EXCEPTION 'unknown kind of note' USING ERRCODE = '23514';
  END IF;
  INSERT INTO admissions.inquiry_note (group_id, inquiry_id, author_person_id, kind, body)
  VALUES (r.group_id, r.id, me, p_kind, btrim(p_body));
  next_status := CASE WHEN r.status = 'new' AND p_kind <> 'note' THEN 'contacted' ELSE r.status END;
  UPDATE admissions.inquiry SET status = next_status, last_activity_at = now() WHERE id = r.id;
  RETURN next_status;
END $$;
REVOKE ALL ON FUNCTION admissions.add_inquiry_note(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.add_inquiry_note(uuid, text, text) TO pyth_api;

-- Staff close an inquiry with its outcome. Transitions are checked by the state machine (PY001).
CREATE FUNCTION admissions.close_inquiry(p_inquiry_id uuid, p_outcome text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM admissions.inquiry WHERE id = p_inquiry_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', r.school_id) THEN
    RAISE EXCEPTION 'no such inquiry' USING ERRCODE = 'P0002';
  END IF;
  IF r.status = 'closed' THEN
    RAISE EXCEPTION 'the inquiry is already closed' USING ERRCODE = 'PY001';
  END IF;
  UPDATE admissions.inquiry
     SET status = 'closed', outcome = p_outcome, closed_at = now(), last_activity_at = now()
   WHERE id = r.id;
END $$;
REVOKE ALL ON FUNCTION admissions.close_inquiry(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.close_inquiry(uuid, text) TO pyth_api;

ALTER TABLE admissions.privacy_notice ENABLE ROW LEVEL SECURITY;
ALTER TABLE admissions.inquiry ENABLE ROW LEVEL SECURITY;
ALTER TABLE admissions.inquiry_note ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON admissions.privacy_notice, admissions.inquiry, admissions.inquiry_note TO pyth_api;
-- The notice is public text; within the platform anyone of the group may read it.
CREATE POLICY read ON admissions.privacy_notice FOR SELECT TO pyth_api
  USING (group_id = access.current_group_id());
-- Inquiries: the school's admissions staff only. Not the CEO, School Life, teachers or the kitchen.
CREATE POLICY read ON admissions.inquiry FOR SELECT TO pyth_api
  USING (access.has_permission('admissions.manage', school_id));
CREATE POLICY read ON admissions.inquiry_note FOR SELECT TO pyth_api
  USING (EXISTS (SELECT 1 FROM admissions.inquiry i WHERE i.id = inquiry_id));

-- migrate:down
DROP FUNCTION admissions.close_inquiry(uuid, text);
DROP FUNCTION admissions.add_inquiry_note(uuid, text, text);
DROP FUNCTION admissions.submit_inquiry(text, uuid, uuid, text, text, text, text, smallint, text, text, text, boolean);
DROP FUNCTION admissions.inquiry_form(text);
DROP FUNCTION admissions.publish_privacy_notice(text, text);
DROP TABLE admissions.inquiry_note;
DROP FUNCTION admissions.protect_note();
DROP TABLE admissions.inquiry;
DROP TABLE admissions.privacy_notice;
DELETE FROM meta.state_transition WHERE machine = 'inquiry';
DELETE FROM access.role_permission WHERE permission_code = 'admissions.manage';
DELETE FROM access.permission WHERE code = 'admissions.manage';
DROP SCHEMA admissions;
