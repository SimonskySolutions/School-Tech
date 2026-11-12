-- The daily class register and grades.
BEGIN;
\ir _fixtures.sql
\echo '# 43 register and grades'

\set CLASS '''c1a55000-0000-7000-8000-000000000003'''
INSERT INTO scheduling.school_class (id, group_id, school_id, academic_year, grade_level, label, capacity)
VALUES (:CLASS, :G, :A, '2026/2027', '3', '3A', 24);
UPDATE people.enrolment SET class_id = :CLASS WHERE student_person_id = :K1 AND school_id = :A;

SELECT test.as_person(:PRA);
INSERT INTO academic.attendance (group_id, school_id, class_id, student_person_id, day, status)
VALUES (:G, :A, :CLASS, :K1, '2026-11-05', 'late');
INSERT INTO academic.grade (group_id, school_id, class_id, student_person_id, subject, term, value)
VALUES (:G, :A, :CLASS, :K1, 'Maths', 1, 6);
SELECT test.expect_error(format(
  'INSERT INTO academic.grade (group_id, school_id, class_id, student_person_id, subject, term, value) VALUES (%L, %L, %L, %L, ''Maths'', 1, 1)',
  :G, :A, :CLASS, :K1), '23514', 'grades go from 2 to 6');
SELECT test.expect_error(format(
  'INSERT INTO academic.attendance (group_id, school_id, class_id, student_person_id, day, status) VALUES (%L, %L, %L, %L, ''2026-11-05'', ''present'')',
  :G, :A, :CLASS, :K3), 'PY029', 'only a child in the class can be marked');
RESET ROLE;

SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM academic.grade WHERE student_person_id = :K1) = 1, 'a parent sees their child''s grade');
SELECT test.ok((SELECT count(*) FROM academic.attendance WHERE student_person_id = :K1) = 1, 'and the register');
SELECT test.expect_error(format(
  'INSERT INTO academic.grade (group_id, school_id, class_id, student_person_id, subject, term, value) VALUES (%L, %L, %L, %L, ''Maths'', 1, 6)',
  :G, :A, :CLASS, :K1), '42501', 'but cannot give one');
RESET ROLE;

SELECT test.as_person(:Q);
SELECT test.ok((SELECT count(*) FROM academic.grade) = 0, 'another family sees nothing');
RESET ROLE;

SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM academic.grade) = 0, 'a teacher at another school sees nothing');
RESET ROLE;

ROLLBACK;
