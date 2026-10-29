-- migrate:up

-- A person exists once per group, whatever schools they are connected to.
CREATE TABLE people.person (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL REFERENCES org.education_group (id),
  given_name            text NOT NULL CHECK (length(given_name) BETWEEN 1 AND 100),
  family_name           text NOT NULL CHECK (length(family_name) BETWEEN 1 AND 100),
  preferred_name        text CHECK (length(preferred_name) BETWEEN 1 AND 100),
  date_of_birth         date CHECK (date_of_birth > DATE '1900-01-01'),
  email                 text CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                 text CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  preferred_locale      text CHECK (preferred_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  -- The school whose staff registered this person, so they can see the record
  -- before any enrolment or relationship exists. Null for group-level records.
  registered_school_id  uuid,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pseudonymised')),
  pseudonymised_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, group_id),
  FOREIGN KEY (registered_school_id, group_id) REFERENCES org.school (id, group_id),
  CHECK ((status = 'pseudonymised') = (pseudonymised_at IS NOT NULL))
);
-- E-mail is not unique: family members may share one address. It never grants access.
CREATE INDEX person_email_idx ON people.person (group_id, email) WHERE email IS NOT NULL;
CREATE INDEX person_registered_school_idx ON people.person (registered_school_id);
COMMENT ON TABLE people.person IS 'Personal data. Names, birth date and contact details are redacted in the audit log.';

-- A login at the identity provider, linked to a person. Children may have none.
CREATE TABLE people.login_identity (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  person_id      uuid NOT NULL,
  group_id       uuid NOT NULL,
  provider       text NOT NULL CHECK (provider IN ('keycloak', 'entra_id', 'google', 'development')),
  subject        text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  linked_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  disabled_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  FOREIGN KEY (person_id, group_id) REFERENCES people.person (id, group_id)
);
CREATE INDEX login_identity_person_idx ON people.login_identity (person_id);

-- An individually authorised guardian relationship. Access never follows from
-- a surname, a shared e-mail or a billing account: only from an active,
-- staff-verified row here, and only for the capabilities it grants.
CREATE TABLE people.guardian_relationship (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  guardian_person_id    uuid NOT NULL,
  student_person_id     uuid NOT NULL,
  relationship          text NOT NULL CHECK (relationship IN ('mother', 'father', 'parent', 'legal_guardian', 'foster_carer', 'other')),
  can_view              boolean NOT NULL DEFAULT true,
  can_pay               boolean NOT NULL DEFAULT true,
  can_manage_bookings   boolean NOT NULL DEFAULT true,
  can_consent           boolean NOT NULL DEFAULT false,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  verified_by_person_id uuid,
  verified_at           timestamptz,
  valid_from            date NOT NULL DEFAULT current_date,
  valid_until           date,
  revoked_at            timestamptz,
  revoked_by_person_id  uuid,
  revocation_reason     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guardian_person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (verified_by_person_id) REFERENCES people.person (id),
  FOREIGN KEY (revoked_by_person_id) REFERENCES people.person (id),
  CHECK (guardian_person_id <> student_person_id),
  CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CHECK (status <> 'active' OR (verified_by_person_id IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);
CREATE UNIQUE INDEX guardian_relationship_one_open
  ON people.guardian_relationship (guardian_person_id, student_person_id) WHERE status IN ('pending', 'active');
CREATE INDEX guardian_relationship_guardian_idx ON people.guardian_relationship (guardian_person_id, status);
CREATE INDEX guardian_relationship_student_idx ON people.guardian_relationship (student_person_id);
CREATE INDEX guardian_relationship_verified_by_idx ON people.guardian_relationship (verified_by_person_id);
CREATE INDEX guardian_relationship_revoked_by_idx ON people.guardian_relationship (revoked_by_person_id);

-- A student's enrolment at one school for a period. Billing never changes it:
-- refunds and cancellations act on orders and bookings, not here.
CREATE TABLE people.enrolment (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id           uuid NOT NULL,
  student_person_id  uuid NOT NULL,
  school_id          uuid NOT NULL,
  academic_year      text NOT NULL CHECK (academic_year ~ '^[0-9]{4}/[0-9]{4}$'),
  grade_level        text CHECK (length(grade_level) BETWEEN 1 AND 40),
  class_label        text CHECK (length(class_label) BETWEEN 1 AND 40),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'withdrawn', 'completed')),
  start_date         date NOT NULL,
  end_date           date,
  withdrawn_at       timestamptz,
  withdrawal_reason  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (student_person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  CHECK (end_date IS NULL OR end_date > start_date),
  CHECK (status <> 'withdrawn' OR withdrawn_at IS NOT NULL),
  -- A student cannot hold two overlapping current enrolments at the same school.
  EXCLUDE USING gist (student_person_id WITH =, school_id WITH =, daterange(start_date, end_date, '[)') WITH &&)
    WHERE (status IN ('active', 'suspended'))
);
CREATE INDEX enrolment_school_idx ON people.enrolment (school_id, status);
CREATE INDEX enrolment_student_idx ON people.enrolment (student_person_id);

-- ---------------------------------------------------------------------------
-- Roles and permissions. Policies check permissions, never role names.
-- ---------------------------------------------------------------------------
CREATE TABLE access.permission (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description text NOT NULL
);

CREATE TABLE access.role (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z][a-z_]{1,62}$'),
  name        text NOT NULL,
  scope_level text NOT NULL CHECK (scope_level IN ('group', 'school')),
  description text NOT NULL
);

CREATE TABLE access.role_permission (
  role_code       text NOT NULL REFERENCES access.role (code),
  permission_code text NOT NULL REFERENCES access.permission (code),
  PRIMARY KEY (role_code, permission_code)
);
CREATE INDEX role_permission_permission_idx ON access.role_permission (permission_code);

-- A role held by a person at group scope (school_id null: every school in the
-- group) or at one school.
CREATE TABLE access.role_assignment (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id             uuid NOT NULL,
  person_id            uuid NOT NULL,
  role_code            text NOT NULL REFERENCES access.role (code),
  school_id            uuid,
  valid_from           timestamptz NOT NULL DEFAULT now(),
  valid_until          timestamptz,
  granted_by_person_id uuid REFERENCES people.person (id),
  revoked_at           timestamptz,
  revoked_by_person_id uuid REFERENCES people.person (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (person_id, group_id) REFERENCES people.person (id, group_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX role_assignment_person_idx ON access.role_assignment (person_id);
CREATE INDEX role_assignment_school_idx ON access.role_assignment (school_id);
CREATE INDEX role_assignment_role_idx ON access.role_assignment (role_code);
CREATE INDEX role_assignment_granted_by_idx ON access.role_assignment (granted_by_person_id);
CREATE INDEX role_assignment_revoked_by_idx ON access.role_assignment (revoked_by_person_id);
CREATE UNIQUE INDEX role_assignment_one_current
  ON access.role_assignment (person_id, role_code, coalesce(school_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

-- The school must be set exactly when the role is school-scoped.
CREATE FUNCTION access.check_role_scope() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  level text;
BEGIN
  SELECT r.scope_level INTO level FROM access.role r WHERE r.code = NEW.role_code;
  IF (level = 'group') <> (NEW.school_id IS NULL) THEN
    RAISE EXCEPTION 'role % is %-scoped', NEW.role_code, level USING ERRCODE = 'PY006';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_role_scope BEFORE INSERT OR UPDATE OF role_code, school_id ON access.role_assignment
  FOR EACH ROW EXECUTE FUNCTION access.check_role_scope();

-- Reference data: permissions and the standard roles.
INSERT INTO access.permission (code, description) VALUES
  ('org.manage',              'Configure the group, schools, legal entities and websites'),
  ('people.read',             'Read person records in scope'),
  ('people.manage',           'Create and update person records in scope'),
  ('guardians.manage',        'Verify, change and revoke guardian relationships'),
  ('enrolment.read',          'Read enrolments'),
  ('enrolment.manage',        'Create and change enrolments'),
  ('access.manage',           'Grant and revoke staff roles in scope'),
  ('catalog.read',            'Read unpublished offerings, sessions and prices'),
  ('catalog.manage',          'Manage offerings, sessions, prices and policies'),
  ('bookings.read',           'Read bookings, registers and kitchen counts'),
  ('bookings.manage',         'Create, change and cancel bookings for students'),
  ('finance.read',            'Read orders, payments, allocations, credits and refunds'),
  ('finance.manage',          'Issue staff invoices, credits and record manual payments'),
  ('refunds.approve',         'Approve refunds'),
  ('sensitive.dietary.read',  'Read dietary and health requirements'),
  ('sensitive.dietary.manage','Record and change dietary and health requirements'),
  ('consent.manage',          'Record consent given on paper or in person'),
  ('privacy.read',            'Read the record of processing, retention policies and subject requests'),
  ('privacy.manage',          'Manage processing records, retention policies and subject requests'),
  ('audit.read',              'Read the audit and access logs'),
  ('reports.read',            'Read management reports');

INSERT INTO access.role (code, name, scope_level, description) VALUES
  ('group_ceo',               'CEO',                      'group',  'Management and reporting across all schools'),
  ('group_admin',             'Group administrator',      'group',  'Configures schools, websites, catalog and staff access'),
  ('group_finance',           'Group finance',            'group',  'Finance across all schools and billing entities'),
  ('school_life_coordinator', 'School Life coordinator',  'group',  'Parents, lunch, activities, lessons, trips and services across schools'),
  ('privacy_officer',         'Data protection officer',  'group',  'Processing records, retention, consent and subject requests'),
  ('principal',               'Principal',                'school', 'Leads one school'),
  ('school_admin',            'School administrator',     'school', 'Office and finance administration for one school'),
  ('teacher',                 'Teacher',                  'school', 'Teaching staff at one school'),
  ('kitchen',                 'Kitchen',                  'school', 'Meal preparation at one school');

INSERT INTO access.role_permission (role_code, permission_code)
SELECT r, p FROM (VALUES
  -- The CEO sees everything needed to run the group, but not children's health data.
  ('group_ceo', 'org.manage'), ('group_ceo', 'people.read'), ('group_ceo', 'enrolment.read'),
  ('group_ceo', 'access.manage'), ('group_ceo', 'catalog.read'), ('group_ceo', 'bookings.read'),
  ('group_ceo', 'finance.read'), ('group_ceo', 'refunds.approve'), ('group_ceo', 'reports.read'),
  ('group_ceo', 'audit.read'), ('group_ceo', 'privacy.read'),
  ('group_admin', 'org.manage'), ('group_admin', 'people.read'), ('group_admin', 'people.manage'),
  ('group_admin', 'guardians.manage'), ('group_admin', 'enrolment.read'), ('group_admin', 'enrolment.manage'),
  ('group_admin', 'access.manage'), ('group_admin', 'catalog.read'), ('group_admin', 'catalog.manage'),
  ('group_admin', 'bookings.read'), ('group_admin', 'bookings.manage'), ('group_admin', 'finance.read'),
  ('group_admin', 'reports.read'),
  ('group_finance', 'finance.read'), ('group_finance', 'finance.manage'), ('group_finance', 'refunds.approve'),
  ('group_finance', 'reports.read'), ('group_finance', 'people.read'), ('group_finance', 'enrolment.read'),
  ('group_finance', 'catalog.read'), ('group_finance', 'bookings.read'),
  ('school_life_coordinator', 'people.read'), ('school_life_coordinator', 'enrolment.read'),
  ('school_life_coordinator', 'catalog.read'), ('school_life_coordinator', 'catalog.manage'),
  ('school_life_coordinator', 'bookings.read'), ('school_life_coordinator', 'bookings.manage'),
  ('school_life_coordinator', 'finance.read'), ('school_life_coordinator', 'sensitive.dietary.read'),
  ('school_life_coordinator', 'sensitive.dietary.manage'), ('school_life_coordinator', 'consent.manage'),
  ('school_life_coordinator', 'reports.read'),
  ('privacy_officer', 'privacy.read'), ('privacy_officer', 'privacy.manage'), ('privacy_officer', 'audit.read'),
  ('privacy_officer', 'people.read'),
  ('principal', 'people.read'), ('principal', 'people.manage'), ('principal', 'guardians.manage'),
  ('principal', 'enrolment.read'), ('principal', 'enrolment.manage'), ('principal', 'access.manage'),
  ('principal', 'catalog.read'), ('principal', 'catalog.manage'), ('principal', 'bookings.read'),
  ('principal', 'bookings.manage'), ('principal', 'finance.read'), ('principal', 'reports.read'),
  ('principal', 'sensitive.dietary.read'), ('principal', 'consent.manage'),
  ('school_admin', 'people.read'), ('school_admin', 'people.manage'), ('school_admin', 'guardians.manage'),
  ('school_admin', 'enrolment.read'), ('school_admin', 'enrolment.manage'), ('school_admin', 'catalog.read'),
  ('school_admin', 'bookings.read'), ('school_admin', 'bookings.manage'), ('school_admin', 'finance.read'),
  ('school_admin', 'finance.manage'), ('school_admin', 'consent.manage'),
  ('teacher', 'people.read'), ('teacher', 'enrolment.read'), ('teacher', 'bookings.read'),
  ('kitchen', 'people.read'), ('kitchen', 'catalog.read'), ('kitchen', 'bookings.read'),
  ('kitchen', 'sensitive.dietary.read')
) AS v (r, p);

-- ---------------------------------------------------------------------------
-- Authorization helpers used by row-level security policies. They run as the
-- owner so that they can read the access tables without recursing into RLS.
-- ---------------------------------------------------------------------------

-- True when the signed-in person holds an active role carrying the permission,
-- at group scope, or at p_school_id. With p_school_id null only group scope counts.
CREATE FUNCTION access.has_permission(p_permission text, p_school_id uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM access.role_assignment ra
    JOIN access.role_permission rp ON rp.role_code = ra.role_code AND rp.permission_code = p_permission
    JOIN people.person p ON p.id = ra.person_id AND p.status = 'active'
    WHERE ra.person_id = app.current_person_id()
      AND ra.revoked_at IS NULL
      AND ra.valid_from <= now()
      AND (ra.valid_until IS NULL OR ra.valid_until > now())
      AND (
        (ra.school_id IS NULL
          AND (p_school_id IS NULL
               OR EXISTS (SELECT 1 FROM org.school s WHERE s.id = p_school_id AND s.group_id = ra.group_id)))
        OR (p_school_id IS NOT NULL AND ra.school_id = p_school_id)
      )
  )
$$;

-- True when the permission is held at group scope or at any school.
CREATE FUNCTION access.has_permission_anywhere(p_permission text) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM access.role_assignment ra
    JOIN access.role_permission rp ON rp.role_code = ra.role_code AND rp.permission_code = p_permission
    JOIN people.person p ON p.id = ra.person_id AND p.status = 'active'
    WHERE ra.person_id = app.current_person_id()
      AND ra.revoked_at IS NULL
      AND ra.valid_from <= now()
      AND (ra.valid_until IS NULL OR ra.valid_until > now())
  )
$$;

-- True when the signed-in person is an active, verified guardian of the student
-- with the given capability: view, pay, manage_bookings or consent.
CREATE FUNCTION access.is_guardian_of(p_student_id uuid, p_capability text) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM people.guardian_relationship g
    JOIN people.person p ON p.id = g.guardian_person_id AND p.status = 'active'
    WHERE g.guardian_person_id = app.current_person_id()
      AND g.student_person_id = p_student_id
      AND g.status = 'active'
      AND g.valid_from <= current_date
      AND (g.valid_until IS NULL OR g.valid_until >= current_date)
      AND CASE p_capability
            WHEN 'view' THEN g.can_view
            WHEN 'pay' THEN g.can_pay
            WHEN 'manage_bookings' THEN g.can_manage_bookings
            WHEN 'consent' THEN g.can_consent
            ELSE false
          END
  )
$$;

-- True when the permission applies to this person through a school they are
-- connected to (enrolment, staff role or registration), or at group scope.
CREATE FUNCTION access.has_permission_for_person(p_permission text, p_person_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT access.has_permission(p_permission, NULL)
      OR EXISTS (SELECT 1 FROM people.enrolment e
                 WHERE e.student_person_id = p_person_id AND access.has_permission(p_permission, e.school_id))
      OR EXISTS (SELECT 1 FROM access.role_assignment ra
                 WHERE ra.person_id = p_person_id AND ra.school_id IS NOT NULL AND ra.revoked_at IS NULL
                   AND access.has_permission(p_permission, ra.school_id))
      OR EXISTS (SELECT 1 FROM people.person p
                 WHERE p.id = p_person_id AND p.registered_school_id IS NOT NULL
                   AND access.has_permission(p_permission, p.registered_school_id))
      -- Guardians of students at a school are visible to that school's staff.
      OR EXISTS (SELECT 1 FROM people.guardian_relationship g
                 JOIN people.enrolment e ON e.student_person_id = g.student_person_id
                 WHERE g.guardian_person_id = p_person_id AND g.status IN ('pending', 'active')
                   AND access.has_permission(p_permission, e.school_id))
$$;

-- Who may read a person record (ADR 0005). A guardian sees their children,
-- not the children's other guardians.
CREATE FUNCTION access.can_read_person(p_person_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p_person_id = app.current_person_id()
      OR access.is_guardian_of(p_person_id, 'view')
      OR access.has_permission_for_person('people.read', p_person_id)
$$;

-- Resolves a verified identity-provider subject to an active person. Called by
-- the API before any person context exists.
CREATE FUNCTION access.resolve_login(p_provider text, p_subject text) RETURNS uuid
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT li.person_id
  FROM people.login_identity li
  JOIN people.person p ON p.id = li.person_id AND p.status = 'active'
  WHERE li.provider = p_provider AND li.subject = p_subject AND li.disabled_at IS NULL
$$;

GRANT EXECUTE ON FUNCTION
  access.has_permission(text, uuid), access.has_permission_anywhere(text), access.is_guardian_of(uuid, text),
  access.has_permission_for_person(text, uuid), access.can_read_person(uuid)
  TO pyth_api, pyth_worker;
GRANT EXECUTE ON FUNCTION access.resolve_login(text, text) TO pyth_api;

-- Triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON people.person                FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON people.login_identity        FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON people.guardian_relationship FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON people.enrolment             FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON access.role_assignment       FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON people.person
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('given_name', 'family_name', 'preferred_name', 'date_of_birth', 'email', 'phone');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON people.login_identity
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('subject');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON people.guardian_relationship
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('revocation_reason');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON people.enrolment
  FOR EACH ROW EXECUTE FUNCTION audit.log_change('withdrawal_reason');
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON access.role_assignment
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('person', 'active', 'inactive'), ('person', 'inactive', 'active'),
  ('person', 'active', 'pseudonymised'), ('person', 'inactive', 'pseudonymised'),
  ('guardian_relationship', 'pending', 'active'), ('guardian_relationship', 'pending', 'revoked'),
  ('guardian_relationship', 'active', 'revoked'),
  ('enrolment', 'active', 'suspended'), ('enrolment', 'suspended', 'active'),
  ('enrolment', 'active', 'withdrawn'), ('enrolment', 'suspended', 'withdrawn'),
  ('enrolment', 'active', 'completed');

CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON people.person                FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('person');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON people.guardian_relationship FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('guardian_relationship');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON people.enrolment             FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('enrolment');

-- migrate:down
DELETE FROM meta.state_transition WHERE machine IN ('person', 'guardian_relationship', 'enrolment');
DROP FUNCTION access.resolve_login(text, text);
DROP FUNCTION access.can_read_person(uuid);
DROP FUNCTION access.has_permission_for_person(text, uuid);
DROP FUNCTION access.is_guardian_of(uuid, text);
DROP FUNCTION access.has_permission_anywhere(text);
DROP FUNCTION access.has_permission(text, uuid);
DROP TABLE access.role_assignment;
DROP FUNCTION access.check_role_scope();
DROP TABLE access.role_permission;
DROP TABLE access.role;
DROP TABLE access.permission;
DROP TABLE people.enrolment;
DROP TABLE people.guardian_relationship;
DROP TABLE people.login_identity;
DROP TABLE people.person;
