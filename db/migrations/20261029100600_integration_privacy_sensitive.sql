-- migrate:up

-- ---------------------------------------------------------------------------
-- Integration
-- ---------------------------------------------------------------------------

-- Transactional outbox: written in the same transaction as the business change,
-- delivered by the worker. Payloads carry identifiers only, never personal data.
CREATE TABLE integration.outbox_event (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id       uuid NOT NULL UNIQUE DEFAULT uuidv7(),
  group_id       uuid NOT NULL REFERENCES org.education_group (id),
  aggregate_type text NOT NULL CHECK (aggregate_type ~ '^[a-z_]+\.[a-z_]+$'),
  aggregate_id   uuid NOT NULL,
  event_type     text NOT NULL CHECK (event_type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  payload        jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 8192),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  available_at   timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error     text
);
CREATE INDEX outbox_event_pending_idx ON integration.outbox_event (available_at, id) WHERE published_at IS NULL;
CREATE INDEX outbox_event_aggregate_idx ON integration.outbox_event (aggregate_type, aggregate_id);
COMMENT ON COLUMN integration.outbox_event.payload IS 'Identifiers and codes only. Personal data is read from the source tables by the consumer.';

-- Verified events received from providers (payment webhooks and others).
-- The unique key makes duplicate deliveries harmless; only events whose
-- signature was verified are stored.
CREATE TABLE integration.inbound_event (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  provider            text NOT NULL CHECK (provider IN ('stripe', 'shkolo', 'accounting', 'esignature', 'identity')),
  provider_mode       text NOT NULL CHECK (provider_mode IN ('test', 'live')),
  provider_event_id   text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 255),
  event_type          text NOT NULL,
  provider_created_at timestamptz NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  signature_verified  boolean NOT NULL CHECK (signature_verified),
  payload             jsonb,
  payload_purged_at   timestamptz,
  processing_status   text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  processed_at        timestamptz,
  last_error          text,
  UNIQUE (provider, provider_mode, provider_event_id),
  CHECK (payload IS NOT NULL OR payload_purged_at IS NOT NULL)
);
CREATE INDEX inbound_event_pending_idx ON integration.inbound_event (received_at) WHERE processing_status IN ('received', 'failed');
CREATE INDEX inbound_event_purge_idx ON integration.inbound_event (received_at) WHERE payload IS NOT NULL;
COMMENT ON COLUMN integration.inbound_event.payload IS 'Provider payloads can contain personal data; purged after the retention period.';

-- Identifiers of our records in external systems.
CREATE TABLE integration.external_reference (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id    uuid NOT NULL REFERENCES org.education_group (id),
  system      text NOT NULL CHECK (system IN ('shkolo', 'accounting', 'stripe', 'identity', 'esignature')),
  entity_type text NOT NULL CHECK (entity_type ~ '^[a-z_]+\.[a-z_]+$'),
  entity_id   uuid NOT NULL,
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 255),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (system, entity_type, external_id),
  UNIQUE (system, entity_type, entity_id)
);
CREATE INDEX external_reference_entity_idx ON integration.external_reference (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Privacy (GDPR). These tables record decisions the DPO owns; they are not
-- prefilled with legal content (ADR 0006).
-- ---------------------------------------------------------------------------
CREATE TABLE privacy.retention_policy (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id             uuid NOT NULL REFERENCES org.education_group (id),
  code                 text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_.-]{1,62}$'),
  description          text NOT NULL,
  applies_to           text NOT NULL,
  retain_for           interval NOT NULL CHECK (retain_for > interval '0'),
  after_action         text NOT NULL CHECK (after_action IN ('delete', 'pseudonymise', 'archive', 'review')),
  legal_basis_note     text,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  approved_by_person_id uuid REFERENCES people.person (id),
  approved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code),
  CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_by_person_id IS NOT NULL))
);
CREATE INDEX retention_policy_approved_by_idx ON privacy.retention_policy (approved_by_person_id);

-- Record of processing activities (Art. 30): purposes and lawful bases.
CREATE TABLE privacy.processing_purpose (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL REFERENCES org.education_group (id),
  code                  text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_.-]{1,62}$'),
  name                  text NOT NULL,
  description           text NOT NULL,
  lawful_basis          text NOT NULL CHECK (lawful_basis IN ('consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests')),
  special_category      boolean NOT NULL DEFAULT false,
  art9_condition        text,
  retention_policy_id   uuid REFERENCES privacy.retention_policy (id),
  status                text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  approved_by_person_id uuid REFERENCES people.person (id),
  approved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code),
  CHECK (NOT special_category OR art9_condition IS NOT NULL),
  CHECK (status <> 'approved' OR (approved_at IS NOT NULL AND approved_by_person_id IS NOT NULL))
);
CREATE INDEX processing_purpose_retention_idx ON privacy.processing_purpose (retention_policy_id);
CREATE INDEX processing_purpose_approved_by_idx ON privacy.processing_purpose (approved_by_person_id);

-- Consent given or withdrawn, by the person or by a guardian for a child (Art. 7, 8).
CREATE TABLE privacy.consent_record (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id               uuid NOT NULL,
  subject_person_id      uuid NOT NULL,
  given_by_person_id     uuid NOT NULL,
  purpose_id             uuid NOT NULL REFERENCES privacy.processing_purpose (id),
  school_id              uuid,
  wording_version        text NOT NULL CHECK (length(wording_version) BETWEEN 1 AND 100),
  channel                text NOT NULL CHECK (channel IN ('family_portal', 'paper', 'in_person')),
  recorded_by_person_id  uuid REFERENCES people.person (id),
  status                 text NOT NULL DEFAULT 'given' CHECK (status IN ('given', 'withdrawn')),
  given_at               timestamptz NOT NULL DEFAULT now(),
  withdrawn_at           timestamptz,
  withdrawn_by_person_id uuid REFERENCES people.person (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (subject_person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (given_by_person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  CHECK (status <> 'withdrawn' OR (withdrawn_at IS NOT NULL AND withdrawn_by_person_id IS NOT NULL))
);
CREATE INDEX consent_record_subject_idx ON privacy.consent_record (subject_person_id, purpose_id);
CREATE INDEX consent_record_given_by_idx ON privacy.consent_record (given_by_person_id);
CREATE INDEX consent_record_purpose_idx ON privacy.consent_record (purpose_id);
CREATE INDEX consent_record_school_idx ON privacy.consent_record (school_id);
CREATE INDEX consent_record_recorded_by_idx ON privacy.consent_record (recorded_by_person_id);
CREATE INDEX consent_record_withdrawn_by_idx ON privacy.consent_record (withdrawn_by_person_id);

-- Data subject requests (Art. 15-21), due one month after receipt (Art. 12(3)).
CREATE TABLE privacy.data_subject_request (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL REFERENCES org.education_group (id),
  subject_person_id     uuid REFERENCES people.person (id),
  requester_person_id   uuid REFERENCES people.person (id),
  kind                  text NOT NULL CHECK (kind IN ('access', 'rectification', 'erasure', 'restriction', 'portability', 'objection')),
  status                text NOT NULL DEFAULT 'received'
                        CHECK (status IN ('received', 'verifying_identity', 'in_progress', 'completed', 'rejected', 'withdrawn')),
  received_at           timestamptz NOT NULL DEFAULT now(),
  due_at                timestamptz NOT NULL DEFAULT (now() + interval '1 month'),
  extended_due_at       timestamptz,
  extension_reason      text,
  completed_at          timestamptz,
  outcome_note          text,
  handled_by_person_id  uuid REFERENCES people.person (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (extended_due_at IS NULL OR (extended_due_at <= received_at + interval '3 months' AND extension_reason IS NOT NULL)),
  CHECK (status NOT IN ('completed', 'rejected') OR completed_at IS NOT NULL)
);
CREATE INDEX data_subject_request_open_idx ON privacy.data_subject_request (due_at) WHERE status NOT IN ('completed', 'rejected', 'withdrawn');
CREATE INDEX data_subject_request_subject_idx ON privacy.data_subject_request (subject_person_id);
CREATE INDEX data_subject_request_requester_idx ON privacy.data_subject_request (requester_person_id);
CREATE INDEX data_subject_request_handled_by_idx ON privacy.data_subject_request (handled_by_person_id);

-- ---------------------------------------------------------------------------
-- Special-category data (Art. 9), segregated.
-- ---------------------------------------------------------------------------
CREATE TABLE sensitive.dietary_requirement (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  student_person_id     uuid NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('allergy', 'intolerance', 'medical_diet', 'religious_or_cultural', 'vegetarian', 'vegan', 'other')),
  is_health_data        boolean GENERATED ALWAYS AS (kind IN ('allergy', 'intolerance', 'medical_diet')) STORED,
  description           text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  severity              text CHECK (severity IN ('information', 'moderate', 'severe', 'life_threatening')),
  provided_by_person_id uuid NOT NULL,
  verified_by_person_id uuid REFERENCES people.person (id),
  valid_from            date NOT NULL DEFAULT current_date,
  valid_until           date,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (provided_by_person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);
CREATE INDEX dietary_requirement_student_idx ON sensitive.dietary_requirement (student_person_id);
CREATE INDEX dietary_requirement_provided_by_idx ON sensitive.dietary_requirement (provided_by_person_id);
CREATE INDEX dietary_requirement_verified_by_idx ON sensitive.dietary_requirement (verified_by_person_id);

-- ---------------------------------------------------------------------------
-- Erasure that keeps legally required records (ADR 0006). Run by the worker
-- after a data subject request is approved; nobody else can execute it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION privacy.pseudonymise_person(p_person_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  token text := 'P-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
BEGIN
  UPDATE people.person
     SET given_name = 'Pseudonymised', family_name = token, preferred_name = NULL, date_of_birth = NULL,
         email = NULL, phone = NULL, preferred_locale = NULL,
         status = 'pseudonymised', pseudonymised_at = now()
   WHERE id = p_person_id AND status <> 'pseudonymised';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person % not found or already pseudonymised', p_person_id USING ERRCODE = 'PY011';
  END IF;

  UPDATE people.login_identity
     SET subject = 'erased:' || id::text, disabled_at = coalesce(disabled_at, now())
   WHERE person_id = p_person_id;

  UPDATE people.guardian_relationship
     SET status = 'revoked', revoked_at = now(), revocation_reason = 'data subject erasure'
   WHERE (guardian_person_id = p_person_id OR student_person_id = p_person_id) AND status IN ('pending', 'active');

  DELETE FROM sensitive.dietary_requirement WHERE student_person_id = p_person_id;
  -- Orders, payments, allocations, consent records and audit rows stay: they are
  -- kept under legal obligations and now refer to a pseudonymous person.
END $$;
GRANT EXECUTE ON FUNCTION privacy.pseudonymise_person(uuid) TO pyth_worker;

-- Triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON privacy.retention_policy      FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON privacy.processing_purpose    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON privacy.consent_record        FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON privacy.data_subject_request  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sensitive.dietary_requirement FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON privacy.retention_policy     FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON privacy.processing_purpose   FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON privacy.consent_record       FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON privacy.data_subject_request FOR EACH ROW EXECUTE FUNCTION audit.log_change('outcome_note', 'extension_reason');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON sensitive.dietary_requirement FOR EACH ROW EXECUTE FUNCTION audit.log_change('description');

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('retention_policy', 'draft', 'approved'), ('retention_policy', 'approved', 'retired'), ('retention_policy', 'draft', 'retired'),
  ('processing_purpose', 'draft', 'approved'), ('processing_purpose', 'approved', 'retired'), ('processing_purpose', 'draft', 'retired'),
  ('consent_record', 'given', 'withdrawn'),
  ('data_subject_request', 'received', 'verifying_identity'), ('data_subject_request', 'received', 'in_progress'),
  ('data_subject_request', 'verifying_identity', 'in_progress'), ('data_subject_request', 'verifying_identity', 'rejected'),
  ('data_subject_request', 'in_progress', 'completed'), ('data_subject_request', 'in_progress', 'rejected'),
  ('data_subject_request', 'received', 'withdrawn'), ('data_subject_request', 'verifying_identity', 'withdrawn'),
  ('data_subject_request', 'in_progress', 'withdrawn');

CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON privacy.retention_policy     FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('retention_policy');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON privacy.processing_purpose   FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('processing_purpose');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON privacy.consent_record       FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('consent_record');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON privacy.data_subject_request FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('data_subject_request');

-- migrate:down
DELETE FROM meta.state_transition WHERE machine IN ('retention_policy', 'processing_purpose', 'consent_record', 'data_subject_request');
DROP FUNCTION privacy.pseudonymise_person(uuid);
DROP TABLE sensitive.dietary_requirement;
DROP TABLE privacy.data_subject_request;
DROP TABLE privacy.consent_record;
DROP TABLE privacy.processing_purpose;
DROP TABLE privacy.retention_policy;
DROP TABLE integration.external_reference;
DROP TABLE integration.inbound_event;
DROP TABLE integration.outbox_event;
