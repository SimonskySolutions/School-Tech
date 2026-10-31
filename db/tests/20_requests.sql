-- Parent requests to School Life (M4.7).
BEGIN;
\ir _fixtures.sql
\echo '# 20 parent requests'

-- A guardian opens a request about their child, to the child's school only.
SELECT test.as_person(:Q);
SELECT test.expect_error(format('SELECT people.open_family_request(%L, %L, %L, %L, %L)', :K1, :A, 'question', 'Hello', 'Hi'),
  'P0002', 'another parent cannot write about the child');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT people.open_family_request(%L, %L, %L, %L, %L)', :K1, :B, 'question', 'Hello', 'Hi'),
  '23503', 'a request goes to a school the child attends');
SELECT test.expect_error(format('SELECT people.open_family_request(%L, %L, %L, %L, %L)', :K1, :A, 'gossip', 'Hello', 'Hi'),
  '23514', 'only known kinds of request');
CREATE TEMP TABLE req ON COMMIT DROP AS
SELECT people.open_family_request(:K1, :A, 'absence', 'Kid is ill on Monday (synthetic)', 'A cold; back on Tuesday.') AS id;
GRANT SELECT ON req TO pyth_api;
SELECT test.ok((SELECT status FROM people.family_request WHERE id = (SELECT id FROM req)) = 'open', 'the request is open');
SELECT test.ok((SELECT count(*) FROM people.family_request_message WHERE request_id = (SELECT id FROM req) AND NOT from_school) = 1,
  'the first message is the family''s');
SELECT test.expect_error('INSERT INTO people.family_request_message (group_id, request_id, author_person_id, from_school, body) SELECT group_id, id, requested_by_person_id, true, ''forged'' FROM people.family_request',
  '42501', 'nobody writes messages except through the functions');

-- Who sees it: the school's staff who handle requests; not other schools, not the CEO, not the kitchen.
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM people.family_request) = 0, 'another parent sees no request');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM people.family_request) = 0, 'a teacher at another school sees nothing');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT count(*) FROM people.family_request) = 0, 'the kitchen sees no requests');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM people.family_request) = 0, 'the CEO sees no requests');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.ok((SELECT count(*) FROM people.family_request_message) = 1, 'the principal reads the request');

-- Working on it, answering, the family replying, closing.
SELECT test.ok(people.set_family_request_status((SELECT id FROM req), 'in_progress') = 'in_progress', 'the principal takes it on');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error('SELECT people.set_family_request_status((SELECT id FROM req), ''in_progress'')',
  '42501', 'the family cannot mark it in progress');
RESET ROLE; SELECT test.as_person(:SL);
SELECT test.ok(people.reply_to_family_request((SELECT id FROM req), 'Thank you, noted. Get well soon.') = 'answered',
  'School Life answers');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok(people.reply_to_family_request((SELECT id FROM req), 'Actually Wednesday too.') = 'open',
  'the family''s reply reopens an answered request');
SELECT test.ok((SELECT count(*) FROM people.family_request_message WHERE request_id = (SELECT id FROM req)) = 3,
  'the family sees the whole conversation');
SELECT test.ok(people.set_family_request_status((SELECT id FROM req), 'closed') = 'closed', 'the family closes it');
SELECT test.expect_error('SELECT people.reply_to_family_request((SELECT id FROM req), ''One more thing'')',
  'PY001', 'a closed request takes no more messages');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT test.expect_error('SELECT people.set_family_request_status((SELECT id FROM req), ''in_progress'')',
  'PY001', 'a closed request is not reopened');

RESET ROLE;
SELECT test.expect_error('UPDATE people.family_request_message SET body = ''changed''', 'PY004', 'messages are permanent');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM audit.change_log WHERE changes::text LIKE '%A cold%' OR changes::text LIKE '%ill on Monday%'),
  'what a request says never reaches the audit log');

ROLLBACK;
