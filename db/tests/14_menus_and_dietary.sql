-- Lunch menus with allergens, and who verifies a child's dietary needs (M4.1).
BEGIN;
\ir _fixtures.sql
\echo '# 14 lunch menus and dietary needs'

-- Menus: School Life and the school's kitchen publish them; parents read them.
RESET ROLE; SELECT test.as_person(:KITA);
INSERT INTO scheduling.menu_dish (group_id, school_id, session_id, position, course, name, allergens)
VALUES (:G, :A, :SLA, 1, 'main', 'Peanut noodles', '{peanuts,gluten}'),
       (:G, :A, :SLA, 2, 'dessert', 'Fruit', '{}');
SELECT test.ok((SELECT count(*) FROM scheduling.menu_dish WHERE session_id = :SLA) = 2,
  'the kitchen of School A publishes its lunch menu');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.menu_dish (group_id, school_id, session_id, position, course, name) VALUES (%L,%L,%L,1,%L,%L)',
  :G, :C, :SLC, 'main', 'Soup'), '42501', 'the kitchen of School A cannot write the menu of another school');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.menu_dish (group_id, school_id, session_id, position, course, name, allergens) VALUES (%L,%L,%L,3,%L,%L,%L)',
  :G, :A, :SLA, 'main', 'Mystery', '{tree-bark}'), '23514', 'only the 14 declared allergen codes are accepted');

RESET ROLE; SELECT test.as_person(:SL);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.menu_dish (group_id, school_id, session_id, position, course, name) VALUES (%L,%L,%L,1,%L,%L)',
  :G, :A, :SCHA, 'main', 'Pizza'), '23514', 'a menu cannot be attached to a club session');

RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT allergens FROM scheduling.menu_dish WHERE session_id = :SLA AND position = 1) = '{peanuts,gluten}',
  'a parent reads the menu and its allergens');
UPDATE scheduling.menu_dish SET name = 'Changed' WHERE session_id = :SLA;
SELECT test.ok((SELECT name FROM scheduling.menu_dish WHERE session_id = :SLA AND position = 1) = 'Peanut noodles',
  'a parent cannot change a menu');

RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM scheduling.menu_dish WHERE session_id = :SLA) = 2,
  'anyone who may see the lunch day sees its menu');
DELETE FROM scheduling.menu_dish WHERE session_id = :SLA;
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM scheduling.menu_dish WHERE session_id = :SLA) = 2,
  'a teacher cannot remove a menu');

-- Dietary needs: a parent records one; it is unverified until staff verify it.
SELECT test.as_person(:P);
INSERT INTO sensitive.dietary_requirement (group_id, student_person_id, kind, description, severity, allergens, provided_by_person_id)
VALUES (:G, :K1, 'allergy', 'Sesame (synthetic)', 'severe', '{sesame}', :P);
RESET ROLE;
SELECT test.ok((SELECT verified_by_person_id IS NULL AND verified_at IS NULL FROM sensitive.dietary_requirement
                WHERE student_person_id = :K1 AND description = 'Sesame (synthetic)'),
  'a need a parent records is unverified');

SELECT test.as_person(:P);
SELECT test.expect_error(format(
  'UPDATE sensitive.dietary_requirement SET verified_by_person_id = %L WHERE description = %L', :P, 'Sesame (synthetic)'),
  '42501', 'a parent cannot verify a need');
SELECT test.expect_error(format(
  'UPDATE sensitive.dietary_requirement SET verified_by_person_id = %L WHERE description = %L', :SL, 'Sesame (synthetic)'),
  '42501', 'a parent cannot record someone else''s verification');

RESET ROLE; SELECT test.as_person(:SL);
UPDATE sensitive.dietary_requirement SET verified_by_person_id = :SL WHERE description = 'Sesame (synthetic)';
RESET ROLE;
SELECT test.ok((SELECT verified_by_person_id = :SL::uuid AND verified_at IS NOT NULL FROM sensitive.dietary_requirement
                WHERE description = 'Sesame (synthetic)'),
  'School Life verifies the need, as themselves and now');

SELECT test.as_person(:P);
UPDATE sensitive.dietary_requirement SET severity = 'moderate' WHERE description = 'Sesame (synthetic)';
RESET ROLE;
SELECT test.ok((SELECT verified_by_person_id IS NULL AND verified_at IS NULL FROM sensitive.dietary_requirement
                WHERE description = 'Sesame (synthetic)'),
  'a parent''s change to a verified need makes it unverified again');

SELECT test.as_person(:SL);
UPDATE sensitive.dietary_requirement SET verified_by_person_id = :CEO WHERE description = 'Sesame (synthetic)';
RESET ROLE;
SELECT test.ok((SELECT verified_by_person_id = :SL::uuid FROM sensitive.dietary_requirement WHERE description = 'Sesame (synthetic)'),
  'staff always verify as themselves, whoever the request names');

-- Taking a need back: only the parent who recorded it, only before verification.
SELECT test.as_person(:P);
DELETE FROM sensitive.dietary_requirement WHERE description = 'Sesame (synthetic)';
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement WHERE description = 'Sesame (synthetic)') = 1,
  'a parent cannot delete a verified need');

SELECT test.as_person(:P);
INSERT INTO sensitive.dietary_requirement (group_id, student_person_id, kind, description, allergens, provided_by_person_id)
VALUES (:G, :K1, 'intolerance', 'Typo (synthetic)', '{milk}', :P);
DELETE FROM sensitive.dietary_requirement WHERE description = 'Typo (synthetic)';
RESET ROLE;
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement WHERE description = 'Typo (synthetic)') = 0,
  'a parent takes back an unverified need they recorded');

SELECT test.as_person(:Q);
SELECT test.expect_error(format(
  'INSERT INTO sensitive.dietary_requirement (group_id, student_person_id, kind, description, provided_by_person_id) VALUES (%L,%L,%L,%L,%L)',
  :G, :K1, 'other', 'Not my child', :Q), '42501', 'a parent cannot record needs for another family''s child');

RESET ROLE; SELECT test.as_person(:KITA);
SELECT test.ok((SELECT allergens FROM sensitive.dietary_requirement WHERE description = 'Sesame (synthetic)') = '{sesame}',
  'the kitchen reads the declared allergens');
UPDATE sensitive.dietary_requirement SET severity = 'information' WHERE description = 'Sesame (synthetic)';
RESET ROLE;
SELECT test.ok((SELECT severity FROM sensitive.dietary_requirement WHERE description = 'Sesame (synthetic)') = 'moderate',
  'the kitchen reads needs but cannot change them');

RESET ROLE; SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM sensitive.dietary_requirement) = 0, 'the CEO sees no dietary needs');

RESET ROLE;
ROLLBACK;
