-- migrate:up

-- The platform's own measures for monitoring (M8.6, ADR 0036): counts and
-- ages only, never a row's content, so the metrics carry no personal data.
-- The worker reads them on every scrape and serves them to Prometheus; the
-- alert rules are in infra/monitoring/rules.
CREATE SCHEMA monitoring;
REVOKE ALL ON SCHEMA monitoring FROM PUBLIC;
GRANT USAGE ON SCHEMA monitoring TO pyth_worker;

CREATE FUNCTION monitoring.platform_metrics()
RETURNS TABLE (metric text, value double precision)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH now_utc AS (SELECT now() AS t),
  dsr AS (
    SELECT coalesce(extended_due_at, due_at) AS due
    FROM privacy.data_subject_request
    WHERE status NOT IN ('completed', 'rejected', 'withdrawn')
  )
  -- Events waiting to be published to the queue, and the oldest one that is due.
  SELECT 'outbox_pending_events', count(*)::float8
    FROM integration.outbox_event WHERE published_at IS NULL
  UNION ALL
  SELECT 'outbox_oldest_pending_seconds',
         coalesce(extract(epoch FROM (SELECT t FROM now_utc) - min(available_at)), 0)::float8
    FROM integration.outbox_event WHERE published_at IS NULL AND available_at <= now()
  UNION ALL
  SELECT 'outbox_retrying_events', count(*)::float8
    FROM integration.outbox_event WHERE published_at IS NULL AND attempts >= 3
  -- Provider webhooks (payments) not yet applied, or given up on.
  UNION ALL
  SELECT 'inbound_events_waiting', count(*)::float8
    FROM integration.inbound_event
   WHERE processing_status IN ('received', 'processing') AND received_at < now() - interval '15 minutes'
  UNION ALL
  SELECT 'inbound_events_failed', count(*)::float8
    FROM integration.inbound_event WHERE processing_status = 'failed'
  -- E-mail (ADR 0031): overdue by more than 15 minutes, and given up on today.
  UNION ALL
  SELECT 'messages_overdue', count(*)::float8
    FROM notify.message
   WHERE status IN ('queued', 'sending') AND next_attempt_at < now() - interval '15 minutes'
  UNION ALL
  SELECT 'messages_failed_last_day', count(*)::float8
    FROM notify.message WHERE status = 'failed' AND updated_at > now() - interval '1 day'
  -- Data subject requests (ADR 0006): open, due within a week, overdue.
  UNION ALL
  SELECT 'data_subject_requests_open', count(*)::float8 FROM dsr
  UNION ALL
  SELECT 'data_subject_requests_due_within_7_days', count(*)::float8
    FROM dsr WHERE due >= now() AND due < now() + interval '7 days'
  UNION ALL
  SELECT 'data_subject_requests_overdue', count(*)::float8 FROM dsr WHERE due < now()
  -- Audit log partitions: months covered after the current one, and rows that
  -- fell into the default partition because their month had none.
  UNION ALL
  SELECT 'audit_partitions_ahead', count(*)::float8
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
   WHERE i.inhparent = 'audit.change_log'::regclass
     AND c.relname ~ '^change_log_[0-9]{4}_[0-9]{2}$'
     AND c.relname > 'change_log_' || to_char(now() AT TIME ZONE 'UTC', 'YYYY_MM')
  UNION ALL
  SELECT 'audit_default_partition_rows', count(*)::float8
    FROM (SELECT 1 FROM audit.change_log_default LIMIT 1000) AS r
$$;
COMMENT ON FUNCTION monitoring.platform_metrics() IS
  'Counts and ages for monitoring (M8.6); no row content. Read by the worker for Prometheus.';
REVOKE ALL ON FUNCTION monitoring.platform_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION monitoring.platform_metrics() TO pyth_worker;

-- migrate:down

DROP FUNCTION monitoring.platform_metrics();
DROP SCHEMA monitoring;
