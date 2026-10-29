-- migrate:up

-- An education group is the top of the tree (the "mother system").
CREATE TABLE org.education_group (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  code              text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  default_time_zone text NOT NULL DEFAULT 'Europe/Sofia',
  default_currency  char(3) NOT NULL DEFAULT 'EUR' CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_locale    text NOT NULL DEFAULT 'bg' CHECK (default_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- A legal entity issues invoices and receives payments. One entity may run
-- several schools; a school's offerings may be billed by different entities.
CREATE TABLE org.legal_entity (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL REFERENCES org.education_group (id),
  legal_name            text NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 300),
  country_code          char(2) NOT NULL DEFAULT 'BG' CHECK (country_code ~ '^[A-Z]{2}$'),
  registration_number   text NOT NULL CHECK (length(registration_number) BETWEEN 1 AND 40),
  vat_number            text CHECK (vat_number ~ '^[A-Z]{2}[0-9A-Z]{2,13}$'),
  registered_address    text,
  payment_provider_account text,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, country_code, registration_number),
  UNIQUE (id, group_id)
);
COMMENT ON COLUMN org.legal_entity.registration_number IS 'Company or BULSTAT number (ЕИК/БУЛСТАТ for Bulgarian entities).';
COMMENT ON COLUMN org.legal_entity.payment_provider_account IS 'Identifier of the payment-provider account that collects for this entity. Not a secret.';

-- A school or campus. Kind covers every institution type in the network.
CREATE TABLE org.school (
  id                        uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id                  uuid NOT NULL REFERENCES org.education_group (id),
  code                      text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name                      text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  kind                      text NOT NULL CHECK (kind IN ('school', 'kindergarten', 'sports_academy', 'training_centre', 'college', 'other')),
  time_zone                 text NOT NULL DEFAULT 'Europe/Sofia',
  default_locale            text NOT NULL DEFAULT 'bg' CHECK (default_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  default_billing_entity_id uuid NOT NULL,
  status                    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code),
  UNIQUE (id, group_id),
  FOREIGN KEY (default_billing_entity_id, group_id) REFERENCES org.legal_entity (id, group_id)
);
CREATE INDEX school_default_billing_entity_idx ON org.school (default_billing_entity_id);

-- A website presents one or more schools; a school may have several websites.
CREATE TABLE org.website (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id        uuid NOT NULL REFERENCES org.education_group (id),
  code            text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  purpose         text NOT NULL CHECK (purpose IN ('school', 'group', 'family_portal', 'campaign')),
  default_locale  text NOT NULL DEFAULT 'bg' CHECK (default_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  cms_tenant_key  text UNIQUE CHECK (cms_tenant_key ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'archived')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code),
  UNIQUE (id, group_id)
);

CREATE TABLE org.website_school (
  website_id   uuid NOT NULL,
  school_id    uuid NOT NULL,
  group_id     uuid NOT NULL,
  is_primary_website_for_school boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (website_id, school_id),
  FOREIGN KEY (website_id, group_id) REFERENCES org.website (id, group_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id)
);
CREATE INDEX website_school_school_idx ON org.website_school (school_id);
CREATE UNIQUE INDEX website_school_one_primary ON org.website_school (school_id) WHERE is_primary_website_for_school;

-- Host names a website answers on. Only verified domains are routed.
CREATE TABLE org.website_domain (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  website_id          uuid NOT NULL,
  group_id            uuid NOT NULL,
  hostname            text NOT NULL UNIQUE
                      CHECK (hostname = lower(hostname)
                             AND length(hostname) <= 253
                             AND hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'),
  is_primary          boolean NOT NULL DEFAULT false,
  verification_method text NOT NULL CHECK (verification_method IN ('dns_txt', 'http_token', 'local_development')),
  verification_token  text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed', 'disabled')),
  verified_at         timestamptz,
  last_checked_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (website_id, group_id) REFERENCES org.website (id, group_id),
  CHECK (status <> 'verified' OR verified_at IS NOT NULL),
  -- Local development domains are only allowed on reserved test suffixes.
  CHECK (verification_method <> 'local_development' OR hostname ~ '\.(localhost|test)$')
);
CREATE INDEX website_domain_website_idx ON org.website_domain (website_id);
CREATE UNIQUE INDEX website_domain_one_primary ON org.website_domain (website_id) WHERE is_primary;

-- Triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON org.education_group FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON org.legal_entity    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON org.school          FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON org.website         FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON org.website_domain  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TRIGGER check_time_zone BEFORE INSERT OR UPDATE OF default_time_zone ON org.education_group
  FOR EACH ROW EXECUTE FUNCTION app.check_time_zone('default_time_zone');
CREATE TRIGGER check_time_zone BEFORE INSERT OR UPDATE OF time_zone ON org.school
  FOR EACH ROW EXECUTE FUNCTION app.check_time_zone('time_zone');

CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON org.education_group FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON org.legal_entity    FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON org.school          FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON org.website         FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON org.website_school  FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON org.website_domain  FOR EACH ROW EXECUTE FUNCTION audit.log_change('verification_token');

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('school', 'draft', 'active'), ('school', 'active', 'archived'), ('school', 'draft', 'archived'),
  ('website', 'draft', 'live'), ('website', 'live', 'archived'), ('website', 'draft', 'archived'), ('website', 'live', 'draft'),
  ('website_domain', 'pending', 'verified'), ('website_domain', 'pending', 'failed'), ('website_domain', 'failed', 'pending'),
  ('website_domain', 'verified', 'failed'), ('website_domain', 'verified', 'disabled'), ('website_domain', 'failed', 'disabled'),
  ('website_domain', 'pending', 'disabled'), ('website_domain', 'disabled', 'pending');

CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON org.school         FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('school');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON org.website        FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('website');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON org.website_domain FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('website_domain');

-- Public host-name resolution for the gateway and websites: verified domains
-- of live websites only. Runs without a signed-in person.
CREATE FUNCTION org.resolve_hostname(p_hostname text)
RETURNS TABLE (website_id uuid, group_id uuid, website_code text, website_purpose text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT w.id, w.group_id, w.code, w.purpose
  FROM org.website_domain d
  JOIN org.website w ON w.id = d.website_id
  WHERE d.hostname = lower(p_hostname)
    AND d.status = 'verified'
    AND w.status = 'live'
$$;

-- migrate:down
DROP FUNCTION org.resolve_hostname(text);
DELETE FROM meta.state_transition WHERE machine IN ('school', 'website', 'website_domain');
DROP TABLE org.website_domain;
DROP TABLE org.website_school;
DROP TABLE org.website;
DROP TABLE org.school;
DROP TABLE org.legal_entity;
DROP TABLE org.education_group;
