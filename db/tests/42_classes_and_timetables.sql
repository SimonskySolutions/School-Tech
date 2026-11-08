-- Classes with a size limit, and the weekly timetable.
BEGIN;
\ir _fixtures.sql
\echo '# 42 classes and timetables'

\set CLASS '''c1a55000-0000-7000-8000-000000000001'''
\set CLASS2 '''c1a55000-0000-7000-8000-000000000002'''
\set TEACH1 '''7ea00000-0000-7000-8000-000000000001'''
\set TEACH2 '''7ea00000-0000-7000-8000-000000000002'''
\set ROOM1 '''700d0000-0000-7000-8000-000000000001'''
\set ROOM2 '''700d0000-0000-7000-8000-000000000002'''
\set PERIOD '''9e510d00-0000-7000-8000-000000000001'''
\set YEAR '''2026/2027'''

INSERT INTO scheduling.resource (id, group_id, school_id, kind, display_name) VALUES
  (:TEACH1, :G, :A, 'teacher', 'Ms Petrova'),
  (:TEACH2, :G, :A, 'teacher', 'Mr Ivanov'),
  (:ROOM1, :G, :A, 'room', 'Room 1'),
  (:ROOM2, :G, :A, 'room', 'Room 2');

-- Who plans
SELECT test.as_person(:PRA);
INSERT INTO scheduling.school_class (id, group_id, school_id, academic_year, grade_level, label, capacity, form_teacher_id, home_room_id)
VALUES (:CLASS, :G, :A, :YEAR, '3', '3A', 1, :TEACH1, :ROOM1);
INSERT INTO scheduling.timetable_period (id, group_id, school_id, position, starts, ends)
VALUES (:PERIOD, :G, :A, 1, '08:30', '09:10');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.school_class (group_id, school_id, academic_year, grade_level, label, capacity) VALUES (%L, %L, %L, ''3'', ''3B'', 20)',
  :G, :B, :YEAR), '42501', 'a principal cannot add a class at another school');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.school_class (group_id, school_id, academic_year, grade_level, label, capacity, form_teacher_id) VALUES (%L, %L, %L, ''3'', ''3C'', 20, %L)',
  :G, :A, :YEAR, :ROOM1), 'PY028', 'a room cannot be a form teacher');
RESET ROLE;

SELECT test.as_person(:P);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.school_class (group_id, school_id, academic_year, grade_level, label, capacity) VALUES (%L, %L, %L, ''3'', ''3D'', 20)',
  :G, :A, :YEAR), '42501', 'a parent cannot add a class');
SELECT test.ok((SELECT count(*) FROM scheduling.school_class WHERE id = :CLASS) = 1, 'a family can see the classes of the group');
RESET ROLE;

-- The limit
UPDATE people.enrolment SET class_label = '3A' WHERE student_person_id = :K1 AND school_id = :A;
SELECT test.ok((SELECT class_id FROM people.enrolment WHERE student_person_id = :K1 AND school_id = :A) = :CLASS,
  'a label finds the class of that name');
SELECT test.ok((SELECT grade_level FROM people.enrolment WHERE student_person_id = :K1 AND school_id = :A) = '3',
  'and the class sets the grade');

INSERT INTO people.person (id, group_id, given_name, family_name, status)
VALUES ('30000000-0000-7000-8000-0000000000aa', :G, 'One', 'Toomany', 'active');
SELECT test.expect_error(format(
  'INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, class_label, start_date)
   VALUES (%L, ''30000000-0000-7000-8000-0000000000aa'', %L, %L, ''3A'', ''2026-09-15'')', :G, :A, :YEAR),
  'PY027', 'a full class takes no more children');

SELECT test.expect_error(format('UPDATE scheduling.school_class SET capacity = 61 WHERE id = %L', :CLASS),
  '23514', 'a class has at most sixty places');
UPDATE scheduling.school_class SET capacity = 2 WHERE id = :CLASS;
INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, class_label, start_date)
VALUES (:G, '30000000-0000-7000-8000-0000000000aa', :A, :YEAR, '3A', '2026-09-15');
SELECT test.ok((SELECT count(*) FROM people.enrolment WHERE class_id = :CLASS) = 2, 'a wider class takes the child');
SELECT test.expect_error(format('UPDATE scheduling.school_class SET capacity = 1 WHERE id = %L', :CLASS),
  'PY027', 'a limit cannot drop below the children already there');

UPDATE people.enrolment SET class_label = 'No such class', class_id = NULL
 WHERE student_person_id = '30000000-0000-7000-8000-0000000000aa';
SELECT test.ok((SELECT class_id FROM people.enrolment WHERE student_person_id = '30000000-0000-7000-8000-0000000000aa') IS NULL,
  'a label without a class stays a plain label');

-- One place at a time
INSERT INTO scheduling.school_class (id, group_id, school_id, academic_year, grade_level, label, capacity)
VALUES (:CLASS2, :G, :A, :YEAR, '4', '4A', 20);
SELECT test.as_person(:PRA);
INSERT INTO scheduling.timetable_entry (group_id, school_id, academic_year, class_id, weekday, period_id, subject, teacher_id, room_id)
VALUES (:G, :A, :YEAR, :CLASS, 1, :PERIOD, 'Maths', :TEACH1, :ROOM1);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.timetable_entry (group_id, school_id, academic_year, class_id, weekday, period_id, subject, teacher_id, room_id)
   VALUES (%L, %L, %L, %L, 1, %L, ''Art'', %L, %L)', :G, :A, :YEAR, :CLASS, :PERIOD, :TEACH2, :ROOM2),
  '23505', 'a class has one lesson in a period');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.timetable_entry (group_id, school_id, academic_year, class_id, weekday, period_id, subject, teacher_id, room_id)
   VALUES (%L, %L, %L, %L, 1, %L, ''Art'', %L, %L)', :G, :A, :YEAR, :CLASS2, :PERIOD, :TEACH1, :ROOM2),
  '23505', 'a teacher is in one place in a period');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.timetable_entry (group_id, school_id, academic_year, class_id, weekday, period_id, subject, teacher_id, room_id)
   VALUES (%L, %L, %L, %L, 1, %L, ''Art'', %L, %L)', :G, :A, :YEAR, :CLASS2, :PERIOD, :TEACH2, :ROOM1),
  '23505', 'a room is in one place in a period');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.timetable_entry (group_id, school_id, academic_year, class_id, weekday, period_id, subject, teacher_id, room_id)
   VALUES (%L, %L, %L, %L, 1, %L, ''Art'', %L, %L)', :G, :A, :YEAR, :CLASS2, :PERIOD, :ROOM2, :TEACH2),
  'PY028', 'a lesson needs a teacher and a room, the right way round');
INSERT INTO scheduling.timetable_entry (group_id, school_id, academic_year, class_id, weekday, period_id, subject, teacher_id, room_id)
VALUES (:G, :A, :YEAR, :CLASS2, 2, :PERIOD, 'Art', :TEACH1, :ROOM1);
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM scheduling.timetable_entry) = 2, 'the same teacher and room are free on another day');

SELECT test.as_person(:TEAB);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.timetable_period (group_id, school_id, position, starts, ends) VALUES (%L, %L, 2, ''09:20'', ''10:00'')', :G, :B),
  '42501', 'a teacher does not plan the timetable');
RESET ROLE;

ROLLBACK;
