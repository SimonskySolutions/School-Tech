-- migrate:up

-- Append-only change log, partitioned by month so that old months can be
-- dropped under an approved retention policy. Values of columns passed to the
-- trigger as arguments are redacted: the log shows that they changed, not what
-- they contain (ADR 0006).
CREATE TABLE audit.change_log (
  id              bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  transaction_id  xid8 NOT NULL DEFAULT pg_current_xact_id(),
  table_schema    text NOT NULL,
  table_name      text NOT NULL,
  row_id          uuid,
  action          text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  db_user         text NOT NULL,
  actor_person_id uuid,
  actor           text,
  request_id      text,
  changes         jsonb NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit.change_log_default PARTITION OF audit.change_log DEFAULT;
CREATE INDEX change_log_row_idx ON audit.change_log (table_schema, table_name, row_id, occurred_at);
CREATE INDEX change_log_actor_idx ON audit.change_log (actor_person_id, occurred_at);

-- Creates monthly partitions from the current month up to p_months_ahead.
CREATE FUNCTION audit.ensure_partitions(p_months_ahead integer DEFAULT 3) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  month_start date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  created integer := 0;
  part_name text;
BEGIN
  FOR i IN 0..p_months_ahead LOOP
    part_name := format('change_log_%s', to_char(month_start + make_interval(months => i), 'YYYY_MM'));
    IF to_regclass(format('audit.%I', part_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE audit.%I PARTITION OF audit.change_log FOR VALUES FROM (%L) TO (%L)',
        part_name,
        (month_start + make_interval(months => i))::timestamp AT TIME ZONE 'UTC',
        (month_start + make_interval(months => i + 1))::timestamp AT TIME ZONE 'UTC');
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END $$;

SELECT audit.ensure_partitions(3);
GRANT EXECUTE ON FUNCTION audit.ensure_partitions(integer) TO pyth_worker;

CREATE FUNCTION audit.log_change() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  redacted text[] := TG_ARGV::text[];
  old_row jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  new_row jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  diff jsonb := '{}';
  col text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR col IN SELECT jsonb_object_keys(new_row) LOOP
      IF col <> 'updated_at' AND new_row -> col IS DISTINCT FROM old_row -> col THEN
        diff := diff || jsonb_build_object(col,
          CASE WHEN col = ANY (redacted) THEN to_jsonb('[redacted]'::text)
               ELSE jsonb_build_object('old', old_row -> col, 'new', new_row -> col) END);
      END IF;
    END LOOP;
    IF diff = '{}' THEN
      RETURN NULL;
    END IF;
  ELSE
    SELECT coalesce(jsonb_object_agg(key,
             CASE WHEN key = ANY (redacted) AND value <> 'null'::jsonb THEN to_jsonb('[redacted]'::text) ELSE value END), '{}')
      INTO diff
      FROM jsonb_each(coalesce(new_row, old_row));
  END IF;

  INSERT INTO audit.change_log (table_schema, table_name, row_id, action, db_user, actor_person_id, actor, request_id, changes)
  VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, (coalesce(new_row, old_row) ->> 'id')::uuid, TG_OP,
          session_user, app.current_person_id(), app.current_actor(), app.current_request_id(), diff);
  RETURN NULL;
END $$;

-- Reads of sensitive data, exports and prints are logged by the API.
CREATE TABLE audit.access_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  actor_person_id   uuid NOT NULL,
  action            text NOT NULL CHECK (action IN ('view', 'export', 'print', 'download')),
  resource          text NOT NULL,
  subject_person_id uuid,
  school_id         uuid,
  record_count      integer CHECK (record_count >= 0),
  request_id        text
);
CREATE INDEX access_log_subject_idx ON audit.access_log (subject_person_id, occurred_at);
CREATE INDEX access_log_actor_idx ON audit.access_log (actor_person_id, occurred_at);

-- migrate:down
DROP TABLE audit.access_log;
DROP FUNCTION audit.log_change();
DROP FUNCTION audit.ensure_partitions(integer);
DROP TABLE audit.change_log;
