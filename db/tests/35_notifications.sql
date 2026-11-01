-- Notifications by e-mail (M7.1, ADR 0031).
BEGIN;
\ir _fixtures.sql
\echo '# 35 notifications'

-- A kind that is not essential, for this test only.
INSERT INTO notify.kind (code, essential, description) VALUES ('test.news', false, 'News for the test');
CREATE TEMP TABLE n (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON n TO pyth_worker, pyth_api;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM n WHERE name = p $$;
\set ORDER '''1e000000-0000-7000-8000-000000000001'''

-- Only the worker queues messages, once per thing.
SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT notify.queue_message(%L, %L, ''order.paid'', ''order:%s'', ''{}'')', :G, :P, :ORDER),
  '42501', 'the API queues no message');
SELECT test.expect_error(format('INSERT INTO notify.message (group_id, person_id, kind_code, dedupe_key) VALUES (%L, %L, ''order.paid'', ''order:%s'')', :G, :P, :ORDER),
  '42501', 'nor writes one');
RESET ROLE; SELECT test.as_worker();
INSERT INTO n SELECT 'paid', notify.queue_message(:G, :P, 'order.paid', 'order:' || :ORDER, '{"order_number": "PY-00001000"}');
SELECT test.ok(notify.queue_message(:G, :P, 'order.paid', 'order:' || :ORDER, '{}') IS NULL
               AND (SELECT count(*) FROM notify.message WHERE kind_code = 'order.paid') = 1,
  'the same message is queued once, however often it is asked for');
SELECT test.expect_error(format('SELECT notify.queue_message(%L, %L, ''order.lost'', ''order:%s'', NULL)', :G, :P, :ORDER),
  '23514', 'only known kinds');
SELECT test.expect_error(format('SELECT notify.queue_message(%L, %L, ''order.paid'', ''Dear parent'', NULL)', :G, :P),
  '23514', 'the key is an identifier, not text');

-- People turn off what is not essential, for themselves only.
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error('SELECT notify.set_preference(''order.paid'', false)', '23514', 'a payment confirmation is always sent');
SELECT notify.set_preference('test.news', false);
SELECT test.ok((SELECT NOT enabled FROM notify.preference WHERE kind_code = 'test.news'), 'the parent turns news off');
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM notify.preference) = 0 AND (SELECT count(*) FROM notify.message) = 0,
  'another parent sees neither their preferences nor their messages');
RESET ROLE; SELECT test.as_worker();
INSERT INTO n SELECT 'news-p', notify.queue_message(:G, :P, 'test.news', 'news:' || :ORDER, NULL);
INSERT INTO n SELECT 'news-q', notify.queue_message(:G, :Q, 'test.news', 'news:' || :ORDER, NULL);
SELECT test.ok((SELECT status = 'skipped' AND skip_reason = 'turned_off' FROM notify.message WHERE id = pg_temp.id('news-p'))
               AND (SELECT status FROM notify.message WHERE id = pg_temp.id('news-q')) = 'queued',
  'a kind turned off is recorded as skipped, for that person only');

-- Claimed with a lease and the address read now; nobody without an address.
RESET ROLE; UPDATE people.person SET email = NULL WHERE id = :Q;
SELECT test.as_worker();
SELECT test.ok((SELECT array_agg(email) FROM notify.claim_messages(10, interval '2 minutes')) = ARRAY['p@family.example.test'],
  'the worker claims the parent''s message with the address they have now');
SELECT test.ok((SELECT skip_reason FROM notify.message WHERE id = pg_temp.id('news-q')) = 'no_address',
  'and skips someone without an address');
SELECT test.ok((SELECT count(*) FROM notify.claim_messages(10, interval '2 minutes')) = 0, 'a claimed message is not claimed again');

-- Retries, then failed and kept; sent once.
SELECT test.ok(notify.mark_attempt_failed(pg_temp.id('paid'), 'connection refused') = 'queued', 'a failure is retried');
SELECT test.ok((SELECT next_attempt_at > now() + interval '50 seconds' AND attempts = 1 FROM notify.message WHERE id = pg_temp.id('paid')),
  'after a minute');
RESET ROLE;
UPDATE notify.message SET next_attempt_at = now() - interval '1 second', attempts = 5 WHERE id = pg_temp.id('paid');
SELECT test.as_worker();
SELECT count(*) FROM notify.claim_messages(10, interval '2 minutes');
SELECT test.ok(notify.mark_attempt_failed(pg_temp.id('paid'), repeat('x', 400)) = 'failed', 'the sixth failure is final');
SELECT test.ok((SELECT length(last_error) = 300 AND status = 'failed' FROM notify.message WHERE id = pg_temp.id('paid')),
  'and the message stays, with a short reason');
RESET ROLE;
SELECT test.expect_error(format('UPDATE notify.message SET status = ''queued'' WHERE id = %L', pg_temp.id('paid')),
  'PY001', 'a failed message is not silently retried');
SELECT test.as_worker();
INSERT INTO n SELECT 'paid2', notify.queue_message(:G, :P, 'order.paid', 'order:1e000000-0000-7000-8000-000000000002', '{"order_number": "PY-00001001"}');
SELECT count(*) FROM notify.claim_messages(10, interval '2 minutes');
SELECT notify.mark_sent(pg_temp.id('paid2'));
SELECT notify.mark_sent(pg_temp.id('paid2'));
SELECT test.ok((SELECT status = 'sent' AND attempts = 1 FROM notify.message WHERE id = pg_temp.id('paid2')), 'sent once');

-- A lease that runs out (a worker stopped) makes the message due again.
INSERT INTO n SELECT 'paid3', notify.queue_message(:G, :P, 'order.paid', 'order:1e000000-0000-7000-8000-000000000003', NULL);
SELECT count(*) FROM notify.claim_messages(10, interval '2 minutes');
RESET ROLE;
UPDATE notify.message SET lease_until = now() - interval '1 second' WHERE id = pg_temp.id('paid3');
SELECT test.as_worker();
SELECT test.ok((SELECT array_agg(id) FROM notify.claim_messages(10, interval '2 minutes')) = ARRAY[pg_temp.id('paid3')],
  'a message whose worker stopped is claimed again');

-- After 90 days only who, what kind and when remain.
RESET ROLE;
UPDATE notify.message SET created_at = now() - interval '91 days' WHERE id = pg_temp.id('paid2');
SELECT test.as_worker();
SELECT test.ok(notify.purge_params(interval '90 days') = 1, 'old parameters are purged');
SELECT test.ok((SELECT params IS NULL AND status = 'sent' FROM notify.message WHERE id = pg_temp.id('paid2')),
  'and the record of what was sent stays');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM notify.message) = 4, 'the parent sees their own messages');
RESET ROLE;

ROLLBACK;
