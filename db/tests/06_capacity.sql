-- Capacity, bookings and reservation expiry. Concurrent attempts on the last
-- seat are tested with two real sessions in scripts/db-test-concurrency.sh.
BEGIN;
\ir _fixtures.sql
\echo '# 06 capacity and bookings'
\set BK1 '''a1000000-0000-7000-8000-000000000001'''

RESET ROLE; SELECT test.as_person(:P);
INSERT INTO scheduling.booking (id, group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id)
VALUES (:BK1, :G, :A, :SCHA, :K1, 'reserved', now() + interval '15 minutes', :P);
RESET ROLE;
SELECT test.ok((SELECT reserved_count FROM scheduling.session WHERE id = :SCHA) = 1, 'a reservation holds the only chess seat');

SELECT test.as_person(:Q);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L, now() + interval %L, %L)',
  :G, :A, :SCHA, :K3, 'reserved', '15 minutes', :Q), 'PY002', 'a second reservation for a full session is refused');

RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L, now() + interval %L, %L)',
  :G, :A, :SLA, :K1, 'confirmed', '15 minutes', :P), '42501', 'a parent cannot create a confirmed booking without payment');
INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id)
VALUES (:G, :A, :SLA, :K1, 'reserved', now() + interval '15 minutes', :P);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L, now() + interval %L, %L)',
  :G, :A, :SLA, :K1, 'reserved', '15 minutes', :P), '23505', 'a child cannot be booked twice on the same session');
SELECT test.expect_error(format('UPDATE scheduling.booking SET status = %L, confirmed_at = now() WHERE id = %L', 'confirmed', :BK1),
  '42501', 'a parent cannot confirm their own reservation');

RESET ROLE; SELECT test.as_person(:S);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L, now() + interval %L, %L)',
  :G, :A, :SLA, :K1, 'reserved', '15 minutes', :S), '42501', 'a pending guardian cannot book for the child');

-- The worker expires the unpaid reservation and the seat is released.
RESET ROLE; SELECT test.as_worker();
UPDATE scheduling.booking SET status = 'expired' WHERE id = :BK1;
RESET ROLE;
SELECT test.ok((SELECT reserved_count FROM scheduling.session WHERE id = :SCHA) = 0, 'an expired reservation releases its seat');
SELECT test.expect_error(format('UPDATE scheduling.booking SET status = %L WHERE id = %L', 'reserved', :BK1),
  'PY001', 'an expired booking cannot return to reserved');

SELECT test.as_person(:Q);
INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id)
VALUES (:G, :A, :SCHA, :K3, 'reserved', now() + interval '15 minutes', :Q);
RESET ROLE;
SELECT test.ok((SELECT reserved_count FROM scheduling.session WHERE id = :SCHA) = 1, 'the released seat can be taken by another child');

-- Late payment recovery: the expired reservation cannot be confirmed while the seat is taken.
SELECT test.as_worker();
SELECT test.expect_error(format('UPDATE scheduling.booking SET status = %L, confirmed_at = now() WHERE id = %L', 'confirmed', :BK1),
  'PY002', 'a late payment cannot confirm a seat that has been taken (refund or credit instead)');

-- Staff cancel the session; no new bookings are accepted.
RESET ROLE; SELECT test.as_person(:PRA);
UPDATE scheduling.session SET status = 'cancelled' WHERE id = :SLA;
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L, now() + interval %L, %L)',
  :G, :A, :SLC, :K1, 'reserved', '15 minutes', :P), '23503', 'a booking must belong to the session''s own school');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L, now() + interval %L, %L)',
  :G, :A, :SLA, :K1, 'reserved', '15 minutes', :P), 'PY007', 'a cancelled session accepts no bookings');
-- RLS gives a parent no session rows to update, so the change is a no-op.
UPDATE scheduling.session SET capacity = 500 WHERE id = :SLC;
RESET ROLE;
SELECT test.ok((SELECT capacity FROM scheduling.session WHERE id = :SLC) = 50, 'a parent cannot change session capacity');

ROLLBACK;
