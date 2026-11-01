-- migrate:up

-- Consent from families (M6.6, ADR 0030): guardians give and withdraw
-- consent, per purpose, for the exact wording the data protection officer
-- published. Writes to privacy.consent_record go only through the functions
-- below, so every record names its wording.

CREATE TABLE privacy.consent_wording (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id               uuid NOT NULL REFERENCES org.education_group (id),
  purpose_id             uuid NOT NULL REFERENCES privacy.processing_purpose (id),
  version                integer NOT NULL CHECK (version >= 1),
  wording                text NOT NULL CHECK (length(wording) BETWEEN 20 AND 4000),
  -- A change of substance: consents to earlier versions stop counting.
  renewal_required       boolean NOT NULL DEFAULT false,
  published_by_person_id uuid NOT NULL REFERENCES people.person (id),
  published_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purpose_id, version)
);
CREATE INDEX consent_wording_published_by_idx ON privacy.consent_wording (published_by_person_id);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON privacy.consent_wording
  FOR EACH ROW EXECUTE FUNCTION scheduling.append_only();
CREATE TRIGGER audit AFTER INSERT ON privacy.consent_wording FOR EACH ROW EXECUTE FUNCTION audit.log_change();
ALTER TABLE privacy.consent_wording ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON privacy.consent_wording TO pyth_api;
-- Published wording is part of the privacy notice: anyone in the group reads it.
CREATE POLICY read ON privacy.consent_wording FOR SELECT TO pyth_api USING (group_id = access.current_group_id());

ALTER TABLE privacy.consent_record ADD COLUMN wording_id uuid REFERENCES privacy.consent_wording (id);
CREATE INDEX consent_record_wording_idx ON privacy.consent_record (wording_id);
-- One consent in force per child and purpose; withdrawn ones stay as evidence.
CREATE UNIQUE INDEX consent_record_given_idx ON privacy.consent_record (subject_person_id, purpose_id) WHERE status = 'given';

-- Only through the functions from now on (ADR 0030).
DROP POLICY give ON privacy.consent_record;
DROP POLICY withdraw ON privacy.consent_record;
REVOKE INSERT, UPDATE ON privacy.consent_record FROM pyth_api;

-- Purposes families are asked about: consent as the basis, approved, with wording.
CREATE FUNCTION privacy.is_family_purpose(p_purpose_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM privacy.processing_purpose pp
                  WHERE pp.id = p_purpose_id AND pp.lawful_basis = 'consent' AND pp.status = 'approved'
                    AND pp.group_id = access.current_group_id()
                    AND EXISTS (SELECT 1 FROM privacy.consent_wording w WHERE w.purpose_id = pp.id))
$$;
REVOKE ALL ON FUNCTION privacy.is_family_purpose(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.is_family_purpose(uuid) TO pyth_api;

CREATE FUNCTION privacy.current_wording(p_purpose_id uuid) RETURNS uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ SELECT id FROM privacy.consent_wording WHERE purpose_id = p_purpose_id ORDER BY version DESC LIMIT 1 $$;
REVOKE ALL ON FUNCTION privacy.current_wording(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.current_wording(uuid) TO pyth_api;

-- Does a consent given for this wording still count: no later version asked again?
CREATE FUNCTION privacy.wording_still_counts(p_wording_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM privacy.consent_wording given
                       JOIN privacy.consent_wording later ON later.purpose_id = given.purpose_id
                      WHERE given.id = p_wording_id AND later.version > given.version AND later.renewal_required)
$$;
REVOKE ALL ON FUNCTION privacy.wording_still_counts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.wording_still_counts(uuid) TO pyth_api;

-- The data protection officer publishes the next wording of a consent purpose.
CREATE FUNCTION privacy.publish_wording(p_purpose_id uuid, p_wording text, p_renewal_required boolean) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pp record;
  v_id uuid;
BEGIN
  IF app.current_person_id() IS NULL OR NOT access.has_permission('privacy.manage') THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pp FROM privacy.processing_purpose WHERE id = p_purpose_id AND group_id = access.current_group_id() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such purpose' USING ERRCODE = 'P0002';
  END IF;
  IF pp.lawful_basis <> 'consent' OR pp.status <> 'approved' THEN
    RAISE EXCEPTION 'wording is published for approved consent purposes only' USING ERRCODE = '23514';
  END IF;
  INSERT INTO privacy.consent_wording (group_id, purpose_id, version, wording, renewal_required, published_by_person_id)
  SELECT pp.group_id, pp.id, coalesce(max(w.version), 0) + 1, btrim(p_wording),
         coalesce(p_renewal_required, false) AND count(w.id) > 0, app.current_person_id()
    FROM privacy.consent_wording w WHERE w.purpose_id = pp.id
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION privacy.publish_wording(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.publish_wording(uuid, text, boolean) TO pyth_api;

-- A guardian who may consent gives consent for the child, for the purpose's
-- latest wording; a consent to older wording is replaced.
CREATE FUNCTION privacy.give_consent(p_student_id uuid, p_purpose_id uuid, p_wording_id uuid) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  w record;
  v_existing record;
  v_id uuid;
BEGIN
  IF app.current_person_id() IS NULL OR NOT access.is_guardian_of(p_student_id, 'consent') THEN
    RAISE EXCEPTION 'only a guardian who may consent for the child' USING ERRCODE = 'P0002';
  END IF;
  IF NOT privacy.is_family_purpose(p_purpose_id) THEN
    RAISE EXCEPTION 'no such purpose' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO w FROM privacy.consent_wording WHERE id = p_wording_id AND purpose_id = p_purpose_id;
  IF NOT FOUND OR w.id IS DISTINCT FROM privacy.current_wording(p_purpose_id) THEN
    RAISE EXCEPTION 'the wording has changed: read the current wording' USING ERRCODE = 'PY001';
  END IF;
  SELECT * INTO v_existing FROM privacy.consent_record
   WHERE subject_person_id = p_student_id AND purpose_id = p_purpose_id AND status = 'given' FOR UPDATE;
  IF FOUND THEN
    IF v_existing.wording_id = w.id THEN
      RAISE EXCEPTION 'consent is already given' USING ERRCODE = 'PY001';
    END IF;
    UPDATE privacy.consent_record SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by_person_id = app.current_person_id()
     WHERE id = v_existing.id;
  END IF;
  INSERT INTO privacy.consent_record (group_id, subject_person_id, given_by_person_id, purpose_id, wording_id,
                                      wording_version, channel)
  VALUES (access.current_group_id(), p_student_id, app.current_person_id(), p_purpose_id, w.id, w.version::text,
          'family_portal')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION privacy.give_consent(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.give_consent(uuid, uuid, uuid) TO pyth_api;

-- Withdrawn by a guardian who may consent, or recorded by staff with
-- consent.manage when the withdrawal came on paper. Takes effect at once.
CREATE FUNCTION privacy.withdraw_consent(p_student_id uuid, p_purpose_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF app.current_person_id() IS NULL OR NOT (access.is_guardian_of(p_student_id, 'consent')
       OR access.has_permission_for_person('consent.manage', p_student_id)) THEN
    RAISE EXCEPTION 'only a guardian who may consent for the child' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_id FROM privacy.consent_record
   WHERE subject_person_id = p_student_id AND purpose_id = p_purpose_id AND status = 'given' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no consent is given' USING ERRCODE = 'PY001';
  END IF;
  UPDATE privacy.consent_record SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by_person_id = app.current_person_id()
   WHERE id = v_id;
END $$;
REVOKE ALL ON FUNCTION privacy.withdraw_consent(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.withdraw_consent(uuid, uuid) TO pyth_api;

-- For staff who read the school's enrolments: each pupil enrolled now and,
-- per family purpose, whether consent counts. Not who gave it, nor when.
CREATE FUNCTION privacy.school_consents(p_school_id uuid)
RETURNS TABLE (student_person_id uuid, given_name text, family_name text, class_label text, purpose_id uuid,
               state text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p.id, p.given_name, p.family_name, e.class_label, pp.id,
         CASE WHEN c.id IS NULL THEN 'none'
              WHEN privacy.wording_still_counts(c.wording_id) THEN 'given'
              ELSE 'renewal' END
    FROM people.enrolment e
    JOIN people.person p ON p.id = e.student_person_id AND p.status = 'active'
    CROSS JOIN privacy.processing_purpose pp
    LEFT JOIN privacy.consent_record c
      ON c.subject_person_id = p.id AND c.purpose_id = pp.id AND c.status = 'given'
   WHERE app.current_person_id() IS NOT NULL AND access.has_permission('enrolment.read', p_school_id)
     AND e.school_id = p_school_id AND e.status IN ('active', 'suspended')
     AND e.start_date <= current_date AND (e.end_date IS NULL OR e.end_date > current_date)
     AND pp.group_id = e.group_id AND privacy.is_family_purpose(pp.id)
   ORDER BY e.class_label NULLS LAST, p.family_name, p.given_name, pp.code
$$;
REVOKE ALL ON FUNCTION privacy.school_consents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION privacy.school_consents(uuid) TO pyth_api;

-- migrate:down
DROP FUNCTION privacy.school_consents(uuid);
DROP FUNCTION privacy.withdraw_consent(uuid, uuid);
DROP FUNCTION privacy.give_consent(uuid, uuid, uuid);
DROP FUNCTION privacy.publish_wording(uuid, text, boolean);
DROP FUNCTION privacy.wording_still_counts(uuid);
DROP FUNCTION privacy.current_wording(uuid);
DROP FUNCTION privacy.is_family_purpose(uuid);
GRANT INSERT (id, group_id, subject_person_id, given_by_person_id, purpose_id, school_id, wording_version, channel,
              recorded_by_person_id, given_at),
      UPDATE (status, withdrawn_at, withdrawn_by_person_id)
  ON privacy.consent_record TO pyth_api;
CREATE POLICY give ON privacy.consent_record FOR INSERT TO pyth_api
  WITH CHECK ((channel = 'family_portal' AND given_by_person_id = app.current_person_id()
               AND (subject_person_id = app.current_person_id() OR access.is_guardian_of(subject_person_id, 'consent')))
              OR (channel IN ('paper', 'in_person') AND recorded_by_person_id = app.current_person_id()
                  AND access.has_permission_for_person('consent.manage', subject_person_id)));
CREATE POLICY withdraw ON privacy.consent_record FOR UPDATE TO pyth_api
  USING (subject_person_id = app.current_person_id() OR given_by_person_id = app.current_person_id()
         OR access.is_guardian_of(subject_person_id, 'consent') OR access.has_permission_for_person('consent.manage', subject_person_id))
  WITH CHECK (status = 'withdrawn' AND withdrawn_by_person_id = app.current_person_id());
DROP INDEX privacy.consent_record_given_idx;
ALTER TABLE privacy.consent_record DROP COLUMN wording_id;
DROP TABLE privacy.consent_wording;
