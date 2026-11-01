-- migrate:up

-- Notifications by e-mail (M7.1, ADR 0031): messages are queued here, once
-- per thing, and sent by the worker over SMTP with retries; a person may turn
-- off kinds that are not essential. Only the worker queues and sends; the API
-- reads a person's own preferences and changes them.

CREATE SCHEMA notify;
REVOKE ALL ON SCHEMA notify FROM PUBLIC;
GRANT USAGE ON SCHEMA notify TO pyth_api, pyth_worker;

CREATE TABLE notify.kind (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z]+(\.[a-z_]+)+$'),
  essential   boolean NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 200)
);
INSERT INTO notify.kind (code, essential, description) VALUES
  ('order.paid', true, 'Your payment was received and the order is confirmed');
GRANT SELECT ON notify.kind TO pyth_api, pyth_worker;

CREATE TABLE notify.preference (
  person_id   uuid NOT NULL REFERENCES people.person (id),
  kind_code   text NOT NULL REFERENCES notify.kind (code),
  enabled     boolean NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, kind_code)
);
CREATE INDEX preference_kind_idx ON notify.preference (kind_code);
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON notify.preference
  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

CREATE TABLE notify.message (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id             uuid NOT NULL,
  person_id            uuid NOT NULL,
  kind_code            text NOT NULL REFERENCES notify.kind (code),
  -- Once per thing: "order:<id>", "step:<id>".
  dedupe_key           text NOT NULL CHECK (dedupe_key ~ '^[a-z_]+:[0-9a-f-]{36}(:[a-z0-9_-]{1,40})?$'),
  -- The template's own parameters, purged after 90 days (ADR 0031).
  params               jsonb CHECK (params IS NULL OR (jsonb_typeof(params) = 'object' AND length(params::text) <= 4000)),
  status               text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed')),
  skip_reason          text CHECK (skip_reason IN ('turned_off', 'no_address', 'inactive')),
  attempts             integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  lease_until          timestamptz,
  -- A short reason from the mail service, never a message's content.
  last_error           text CHECK (length(last_error) <= 300),
  created_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Once per person and thing.
  UNIQUE (person_id, kind_code, dedupe_key),
  FOREIGN KEY (person_id, group_id) REFERENCES people.person (id, group_id),
  CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
  CHECK (status <> 'sending' OR lease_until IS NOT NULL)
);
CREATE INDEX message_due_idx ON notify.message (next_attempt_at) WHERE status IN ('queued', 'sending');
CREATE INDEX message_person_idx ON notify.message (person_id, created_at);
CREATE INDEX message_failed_idx ON notify.message (created_at) WHERE status = 'failed';
INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('message', 'queued', 'sending'), ('message', 'sending', 'queued'), ('message', 'sending', 'sent'),
  ('message', 'sending', 'failed'), ('message', 'queued', 'skipped'), ('message', 'sending', 'skipped');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON notify.message
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('message');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON notify.message FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- The worker queues a message once per thing; a kind the person turned off is
-- recorded as skipped. Returns the message, or nothing when it was queued before.
CREATE FUNCTION notify.queue_message(p_group_id uuid, p_person_id uuid, p_kind text, p_dedupe_key text, p_params jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  k record;
  v_id uuid;
  v_off boolean;
BEGIN
  SELECT * INTO k FROM notify.kind WHERE code = p_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such kind of message: %', p_kind USING ERRCODE = '23514';
  END IF;
  v_off := NOT k.essential AND EXISTS (
    SELECT 1 FROM notify.preference WHERE person_id = p_person_id AND kind_code = p_kind AND NOT enabled);
  INSERT INTO notify.message (group_id, person_id, kind_code, dedupe_key, params, status, skip_reason)
  VALUES (p_group_id, p_person_id, p_kind, p_dedupe_key, p_params,
          CASE WHEN v_off THEN 'skipped' ELSE 'queued' END, CASE WHEN v_off THEN 'turned_off' END)
  ON CONFLICT (person_id, kind_code, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION notify.queue_message(uuid, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.queue_message(uuid, uuid, text, text, jsonb) TO pyth_worker;

-- The worker claims due messages for a while (a lease), with the address read
-- now. A message whose person has no address, or is no longer active, is skipped.
CREATE FUNCTION notify.claim_messages(p_limit integer, p_lease interval)
RETURNS TABLE (id uuid, kind_code text, params jsonb, attempts integer, email text, given_name text, family_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE notify.message m SET status = 'skipped',
         skip_reason = CASE WHEN p.status <> 'active' THEN 'inactive' ELSE 'no_address' END
    FROM people.person p
   WHERE p.id = m.person_id AND m.status IN ('queued', 'sending') AND m.next_attempt_at <= now()
     AND (m.status = 'queued' OR m.lease_until < now())
     AND (p.email IS NULL OR p.status <> 'active');
  RETURN QUERY
  WITH due AS (
    SELECT m.id FROM notify.message m
     WHERE m.next_attempt_at <= now()
       AND (m.status = 'queued' OR (m.status = 'sending' AND m.lease_until < now()))
     ORDER BY m.next_attempt_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE notify.message m SET status = 'sending', lease_until = now() + p_lease
      FROM due WHERE m.id = due.id
    RETURNING m.id, m.kind_code, m.params, m.attempts, m.person_id
  )
  SELECT c.id, c.kind_code, c.params, c.attempts, p.email::text, p.given_name, p.family_name
    FROM claimed c JOIN people.person p ON p.id = c.person_id;
END $$;
REVOKE ALL ON FUNCTION notify.claim_messages(integer, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.claim_messages(integer, interval) TO pyth_worker;

CREATE FUNCTION notify.mark_sent(p_message_id uuid) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  UPDATE notify.message SET status = 'sent', sent_at = now(), lease_until = NULL, last_error = NULL,
         attempts = attempts + 1
   WHERE id = p_message_id AND status = 'sending'
$$;
REVOKE ALL ON FUNCTION notify.mark_sent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.mark_sent(uuid) TO pyth_worker;

-- A failed attempt: again after 1, 5 and 30 minutes, 2 and 6 hours; then failed.
CREATE FUNCTION notify.mark_attempt_failed(p_message_id uuid, p_error text) RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  UPDATE notify.message
     SET attempts = attempts + 1,
         status = CASE WHEN attempts + 1 >= 6 THEN 'failed' ELSE 'queued' END,
         next_attempt_at = now() + (ARRAY[interval '1 minute', interval '5 minutes', interval '30 minutes',
                                          interval '2 hours', interval '6 hours', interval '0'])[attempts + 1],
         lease_until = NULL,
         last_error = left(p_error, 300)
   WHERE id = p_message_id AND status = 'sending'
  RETURNING status
$$;
REVOKE ALL ON FUNCTION notify.mark_attempt_failed(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.mark_attempt_failed(uuid, text) TO pyth_worker;

-- Parameters of sent and skipped messages go after 90 days (ADR 0031).
CREATE FUNCTION notify.purge_params(p_after interval) RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH purged AS (
    UPDATE notify.message SET params = NULL
     WHERE params IS NOT NULL AND status IN ('sent', 'skipped', 'failed') AND created_at < now() - p_after
    RETURNING 1
  )
  SELECT count(*)::int FROM purged
$$;
REVOKE ALL ON FUNCTION notify.purge_params(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.purge_params(interval) TO pyth_worker;

-- A person turns a kind off or on for themselves; essential kinds stay on.
CREATE FUNCTION notify.set_preference(p_kind text, p_enabled boolean) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  k record;
BEGIN
  IF app.current_person_id() IS NULL THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO k FROM notify.kind WHERE code = p_kind;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such kind of message' USING ERRCODE = 'P0002';
  END IF;
  IF k.essential AND NOT p_enabled THEN
    RAISE EXCEPTION 'this message is always sent' USING ERRCODE = '23514';
  END IF;
  INSERT INTO notify.preference (person_id, kind_code, enabled)
  VALUES (app.current_person_id(), p_kind, p_enabled)
  ON CONFLICT (person_id, kind_code) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
END $$;
REVOKE ALL ON FUNCTION notify.set_preference(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION notify.set_preference(text, boolean) TO pyth_api;

-- Each person reads their own preferences and messages; the worker reads all.
ALTER TABLE notify.preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE notify.message ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON notify.preference, notify.message TO pyth_api, pyth_worker;
CREATE POLICY own ON notify.preference FOR SELECT TO pyth_api USING (person_id = app.current_person_id());
CREATE POLICY own ON notify.message FOR SELECT TO pyth_api USING (person_id = app.current_person_id());
CREATE POLICY worker_system ON notify.preference TO pyth_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_system ON notify.message TO pyth_worker USING (true) WITH CHECK (true);

-- migrate:down
DROP FUNCTION notify.set_preference(text, boolean);
DROP FUNCTION notify.purge_params(interval);
DROP FUNCTION notify.mark_attempt_failed(uuid, text);
DROP FUNCTION notify.mark_sent(uuid);
DROP FUNCTION notify.claim_messages(integer, interval);
DROP FUNCTION notify.queue_message(uuid, uuid, text, text, jsonb);
DROP TABLE notify.message;
DROP TABLE notify.preference;
DROP TABLE notify.kind;
DELETE FROM meta.state_transition WHERE machine = 'message';
DROP SCHEMA notify;
