-- The platform's own measures for monitoring (M8.6, ADR 0036).
BEGIN;
\ir _fixtures.sql
\echo '# 40 platform metrics'

CREATE TEMP TABLE metrics_before ON COMMIT DROP AS SELECT * FROM monitoring.platform_metrics();
CREATE FUNCTION pg_temp.metric(p_name text) RETURNS double precision
LANGUAGE sql AS $$ SELECT value FROM monitoring.platform_metrics() WHERE metric = p_name $$;
CREATE FUNCTION pg_temp.grew(p_name text, p_by integer) RETURNS boolean
LANGUAGE sql AS $$
  SELECT pg_temp.metric(p_name) = (SELECT value FROM metrics_before WHERE metric = p_name) + p_by
$$;

SELECT test.ok((SELECT array_agg(metric ORDER BY metric) FROM metrics_before) = ARRAY[
  'audit_default_partition_rows', 'audit_partitions_ahead',
  'data_subject_requests_due_within_7_days', 'data_subject_requests_open', 'data_subject_requests_overdue',
  'inbound_events_failed', 'inbound_events_waiting',
  'messages_failed_last_day', 'messages_overdue',
  'outbox_oldest_pending_seconds', 'outbox_pending_events', 'outbox_retrying_events'], 'every measure is reported');

-- An event waiting 20 minutes that failed three times.
INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, available_at, attempts)
VALUES (:G, 'commerce.order', gen_random_uuid(), 'commerce.order.placed', now() - interval '20 minutes', 3);
SELECT test.ok(pg_temp.grew('outbox_pending_events', 1), 'an unpublished event is counted');
SELECT test.ok(pg_temp.metric('outbox_oldest_pending_seconds') >= 1200, 'the oldest waiting event is measured in seconds');
SELECT test.ok(pg_temp.grew('outbox_retrying_events', 1), 'an event retried three times is counted');

-- A payment webhook left unapplied for half an hour, and one given up on.
INSERT INTO integration.inbound_event (provider, provider_mode, provider_event_id, event_type, provider_created_at, received_at,
                                       signature_verified, payload, processing_status)
VALUES ('stripe', 'test', 'evt_metrics_waiting', 'checkout.session.completed', now(), now() - interval '30 minutes', true, '{}', 'received'),
       ('stripe', 'test', 'evt_metrics_failed', 'checkout.session.completed', now(), now(), true, '{}', 'failed');
SELECT test.ok(pg_temp.grew('inbound_events_waiting', 1) AND pg_temp.grew('inbound_events_failed', 1),
  'webhooks waiting too long and failed ones are counted');

-- An e-mail overdue by 20 minutes.
INSERT INTO notify.message (group_id, person_id, kind_code, dedupe_key, next_attempt_at)
VALUES (:G, :P, 'order.paid', 'order:' || gen_random_uuid(), now() - interval '20 minutes');
SELECT test.ok(pg_temp.grew('messages_overdue', 1), 'an overdue e-mail is counted');

-- Requests: one overdue, one due in three days, one completed.
INSERT INTO privacy.data_subject_request (group_id, subject_person_id, requester_person_id, kind, received_at, due_at)
VALUES (:G, :P, :P, 'access', now() - interval '40 days', now() - interval '10 days'),
       (:G, :Q, :Q, 'erasure', now() - interval '27 days', now() + interval '3 days');
INSERT INTO privacy.data_subject_request (group_id, subject_person_id, requester_person_id, kind, status, completed_at)
VALUES (:G, :R, :R, 'access', 'completed', now());
SELECT test.ok(pg_temp.grew('data_subject_requests_open', 2), 'open requests are counted, completed ones are not');
SELECT test.ok(pg_temp.grew('data_subject_requests_overdue', 1), 'an overdue request is counted');
SELECT test.ok(pg_temp.grew('data_subject_requests_due_within_7_days', 1), 'a request due within a week is counted');

-- The worker keeps partitions for the coming months; a row from a month
-- without one lands in the default partition.
SELECT test.ok(pg_temp.metric('audit_partitions_ahead') >= 1, 'next month''s audit partition exists');
INSERT INTO audit.change_log (occurred_at, table_schema, table_name, action, db_user, changes)
VALUES ('2001-01-01', 'test', 'metrics', 'INSERT', current_user, '{}');
SELECT test.ok(pg_temp.grew('audit_default_partition_rows', 1), 'a row in the default audit partition is counted');

-- Only the worker reads the measures.
SELECT test.as_worker();
SELECT test.ok((SELECT count(*) FROM monitoring.platform_metrics()) = 12, 'the worker reads the measures');
RESET ROLE;
SELECT test.as_anonymous();
SELECT test.expect_error('SELECT * FROM monitoring.platform_metrics()', '42501', 'the API cannot');
RESET ROLE;
SELECT test.ok(NOT has_function_privilege('pyth_monitor', 'monitoring.platform_metrics()', 'EXECUTE'),
  'nor can the exporter''s role');

ROLLBACK;
