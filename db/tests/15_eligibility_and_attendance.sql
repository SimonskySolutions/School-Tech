-- Who may take an activity, and who marks attendance (M4.2).
BEGIN;
\ir _fixtures.sql
\echo '# 15 eligibility and attendance'
\set PAST '''80000000-0000-7000-8000-0000000000cf'''
\set PASTB '''90000000-0000-7000-8000-0000000000cf'''

-- The shape of the rules is checked.
RESET ROLE; SELECT test.as_person(:ADM);
SELECT test.expect_error(format('UPDATE catalog.school_offering SET eligibility = %L WHERE id = %L', '{"grade": ["3"]}', :CHA),
  '23514', 'unknown eligibility rules are refused');
SELECT test.expect_error(format('UPDATE catalog.school_offering SET eligibility = %L WHERE id = %L', '{"min_age": 9, "max_age": 7}', :CHA),
  '23514', 'a minimum age above the maximum is refused');
SELECT test.expect_error(format('UPDATE catalog.school_offering SET eligibility = %L WHERE id = %L', '{"grades": []}', :CHA),
  '23514', 'an empty list of grades is refused');
SELECT test.expect_error(format('UPDATE catalog.school_offering SET eligibility = %L WHERE id = %L', '{"max_age": 7.5}', :CHA),
  '23514', 'ages are whole years');

-- Grades: K1 is in grade 3 at School A.
UPDATE catalog.school_offering SET eligibility = '{"grades": ["4", "5"]}' WHERE id = :CHA;
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok(catalog.eligibility_problem(:CHA, :K1, DATE '2026-11-03') = 'for grades 4, 5 only',
  'the parent is told why the child cannot take the club');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L,now() + interval %L,%L)',
  :G, :A, :SCHA, :K1, 'reserved', '30 minutes', :P), 'PY012', 'a child outside the grades cannot be booked, whatever the request');

RESET ROLE; SELECT test.as_person(:Q);
SELECT test.ok(catalog.eligibility_problem(:CHA, :K1, DATE '2026-11-03') IS NULL,
  'another parent learns nothing about the child');

-- Ages: on the day of the session, and only with a recorded date of birth.
RESET ROLE; SELECT test.as_person(:ADM);
UPDATE catalog.school_offering SET eligibility = '{"min_age": 6, "max_age": 10}' WHERE id = :CHA;
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok(catalog.eligibility_problem(:CHA, :K1, DATE '2026-11-03') LIKE 'needs the child''s date of birth%',
  'an age rule needs a date of birth');
RESET ROLE;
UPDATE people.person SET date_of_birth = DATE '2016-11-04' WHERE id = :K1;
SELECT test.as_person(:P);
SELECT test.ok(catalog.eligibility_problem(:CHA, :K1, DATE '2026-11-03') IS NULL,
  'a child is 9 the day before their tenth birthday, and may take the club');
SELECT test.ok(catalog.eligibility_problem(:CHA, :K1, DATE '2027-11-04') = 'for ages 6–10 only',
  'a child of 11 may not');

-- Within the rules, the parent books as before.
INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id)
VALUES (:G, :A, :SCHA, :K1, 'reserved', now() + interval '30 minutes', :P);
SELECT test.ok(true, 'an eligible child is booked');

-- Attendance: a club meeting that started an hour ago, with K1 paid for it.
RESET ROLE;
INSERT INTO scheduling.session (id, group_id, school_id, offering_id, starts_at, ends_at, capacity)
VALUES (:PAST, :G, :A, :CHA, now() - interval '1 hour', now(), 10);
INSERT INTO scheduling.booking (id, group_id, school_id, session_id, student_person_id, status, confirmed_at)
VALUES (:PASTB, :G, :A, :PAST, :K1, 'confirmed', now());

SELECT test.as_person(:TEAB);
SELECT test.expect_error(format('SELECT scheduling.mark_attendance(%L, %L)', :PASTB, 'attended'),
  'P0002', 'a teacher at another school cannot see the booking');
RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.expect_error(format('SELECT scheduling.mark_attendance(%L, %L)', :PASTB, 'attended'),
  '42501', 'the kitchen sees bookings but does not mark attendance');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT scheduling.mark_attendance(%L, %L)', :PASTB, 'attended'),
  'P0002', 'a parent cannot mark attendance');

RESET ROLE; SELECT test.as_person(:PRA);
SELECT scheduling.mark_attendance(:PASTB, 'attended');
RESET ROLE;
SELECT test.ok((SELECT status = 'attended' AND attendance_marked_by_person_id = :PRA::uuid AND attendance_marked_at IS NOT NULL
                FROM scheduling.booking WHERE id = :PASTB),
  'the principal marks the child attended, as themselves');
SELECT test.ok((SELECT confirmed_count FROM scheduling.session WHERE id = :PAST) = 1,
  'marking attendance does not change the place count');

SELECT test.as_person(:SL);
SELECT scheduling.mark_attendance(:PASTB, 'absent');
SELECT test.expect_error(format('SELECT scheduling.mark_attendance(%L, %L)', :PASTB, 'present'),
  '22023', 'attendance is attended or absent');
SELECT test.expect_error(format('SELECT scheduling.mark_attendance(b.id, %L) FROM scheduling.booking b WHERE b.session_id = %L', 'attended', :SCHA),
  'PY013', 'attendance cannot be marked before the session starts');
RESET ROLE;
SELECT test.ok((SELECT status = 'absent' AND attendance_marked_by_person_id = :SL::uuid FROM scheduling.booking WHERE id = :PASTB),
  'School Life corrects it to absent, and the correction is theirs');

SELECT test.as_person(:P);
SELECT test.ok((SELECT status FROM scheduling.booking WHERE id = :PASTB) = 'absent', 'the parent sees the attendance');
SELECT test.expect_error(format('UPDATE scheduling.booking SET status = %L WHERE id = %L', 'attended', :PASTB),
  '42501', 'a parent cannot change attendance directly');

RESET ROLE;
ROLLBACK;
