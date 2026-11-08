-- Queueing for a full club: the first child is told when a seat comes free.
BEGIN;
\ir _fixtures.sql
\echo '# 46 club waiting lists'

\set FULL '''d0000000-0000-7000-8000-000000000001'''
\set NEWKID '''d0000000-0000-7000-8000-000000000002'''

-- A meeting still to come, with its one seat taken.
INSERT INTO scheduling.session (id, group_id, school_id, offering_id, starts_at, ends_at, capacity, confirmed_count)
VALUES (:FULL, :G, :A, :CHA, now() + interval '7 days', now() + interval '7 days 1 hour', 1, 1);

SELECT test.as_person(:P);
SELECT scheduling.join_waiting_list(:CHA, :K1) AS first_entry \gset
SELECT test.ok((SELECT status FROM scheduling.waiting_entry WHERE id = :'first_entry') = 'waiting', 'a family joins the list of a full club');
SELECT test.expect_error(format('SELECT scheduling.join_waiting_list(%L, %L)', :CHA, :K1), '23505', 'once');
SELECT test.expect_error(format('SELECT scheduling.join_waiting_list(%L, %L)', :CHA, :K3), '42501', 'and only for its own child');
SELECT test.expect_error(format('SELECT scheduling.join_waiting_list(%L, %L)', :LA, :K1), 'PY031', 'a club with places has no queue');
RESET ROLE;

SELECT test.as_person(:Q);
SELECT scheduling.join_waiting_list(:CHA, :K3) AS second_entry \gset
SELECT test.ok((SELECT count(*) FROM scheduling.waiting_entry) = 1, 'a family sees only its own place in the queue');
SELECT test.ok(scheduling.queue_position(:'second_entry') = 2, 'and how many are ahead of it');
SELECT test.expect_error(format('SELECT scheduling.leave_waiting_list(%L)', :'first_entry'), '42501', 'and cannot take another child off it');
RESET ROLE;

-- A seat comes free.
UPDATE scheduling.session SET confirmed_count = 0 WHERE id = :FULL;
SELECT test.ok((SELECT status FROM scheduling.waiting_entry WHERE id = :'first_entry') = 'place_free', 'the first child is told');
SELECT test.ok((SELECT told_at IS NOT NULL FROM scheduling.waiting_entry WHERE id = :'first_entry'), 'and the moment is kept');
SELECT test.ok((SELECT status FROM scheduling.waiting_entry WHERE id = :'second_entry') = 'waiting', 'the next child keeps waiting');
SELECT test.ok((SELECT count(*) FROM integration.outbox_event WHERE event_type = 'scheduling.waiting_entry.place_free') = 1,
  'one piece of news goes out');

-- Leaving passes the offer on.
SELECT test.as_person(:P);
SELECT scheduling.leave_waiting_list(:'first_entry');
RESET ROLE;
SELECT test.ok((SELECT status FROM scheduling.waiting_entry WHERE id = :'first_entry') = 'left', 'a family can leave the list');
SELECT test.ok((SELECT status FROM scheduling.waiting_entry WHERE id = :'second_entry') = 'place_free', 'and the next child is told');

-- Booking closes the entry.
INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id)
VALUES (:G, :A, :FULL, :K3, 'reserved', now() + interval '15 minutes', :Q);
SELECT test.ok((SELECT status FROM scheduling.waiting_entry WHERE id = :'second_entry') = 'booked', 'booking takes the child off the list');

-- The news reaches those who can book.
SELECT test.ok(notify.on_place_free(:'second_entry') = 1, 'the family with booking rights is written to');

SELECT test.as_person(:PRA);
SELECT test.ok((SELECT count(*) FROM scheduling.waiting_entry) = 2, 'the school sees its queue');
RESET ROLE;

ROLLBACK;
