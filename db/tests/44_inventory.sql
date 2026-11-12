-- Stock beyond uniforms: every change is a movement, and stock never goes below zero.
BEGIN;
\ir _fixtures.sql
\echo '# 44 inventory'

\set SUP '''5a900000-0000-7000-8000-000000000001'''
\set ITEM '''5a900000-0000-7000-8000-000000000002'''

SELECT test.as_person(:PRA);
INSERT INTO inventory.supplier (id, group_id, name) VALUES (:SUP, :G, 'Textbooks Ltd (synthetic)');
INSERT INTO inventory.item (id, group_id, school_id, kind, name, reorder_level, supplier_id)
VALUES (:ITEM, :G, :A, 'book', 'Maths 3', 5, :SUP);
INSERT INTO inventory.movement (group_id, school_id, item_id, reason, change, moved_by)
VALUES (:G, :A, :ITEM, 'delivered', 10, :PRA);
SELECT test.ok((SELECT on_hand FROM inventory.item WHERE id = :ITEM) = 10, 'a delivery adds to the stock');
INSERT INTO inventory.movement (group_id, school_id, item_id, reason, change, moved_by)
VALUES (:G, :A, :ITEM, 'issued', -4, :PRA);
SELECT test.ok((SELECT on_hand FROM inventory.item WHERE id = :ITEM) = 6, 'issuing takes from it');
SELECT test.expect_error(format(
  'INSERT INTO inventory.movement (group_id, school_id, item_id, reason, change) VALUES (%L, %L, %L, ''issued'', -7)',
  :G, :A, :ITEM), 'PY030', 'stock cannot go below zero');
SELECT test.expect_error(format('UPDATE inventory.item SET on_hand = 100 WHERE id = %L', :ITEM),
  '42501', 'stock changes only by a movement');
SELECT test.expect_error(format(
  'INSERT INTO inventory.movement (group_id, school_id, item_id, reason, change) VALUES (%L, %L, %L, ''issued'', 0)',
  :G, :A, :ITEM), '23514', 'a movement changes something');
SELECT test.expect_error(format(
  'INSERT INTO inventory.item (group_id, school_id, kind, name) VALUES (%L, %L, ''book'', ''Elsewhere'')', :G, :B),
  '42501', 'a principal keeps their own school''s stock only');
RESET ROLE;

SELECT test.as_person(:CEO);
SELECT test.ok((SELECT count(*) FROM inventory.item) = 1, 'the CEO sees stock across the group');
SELECT test.expect_error(format(
  'INSERT INTO inventory.item (group_id, school_id, kind, name) VALUES (%L, %L, ''book'', ''Atlas'')', :G, :A),
  '42501', 'but does not keep it');
RESET ROLE;

SELECT test.as_person(:TEAB);
SELECT test.ok((SELECT count(*) FROM inventory.item) = 0, 'a teacher does not see the stock');
RESET ROLE;

SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM inventory.item) = 0 AND (SELECT count(*) FROM inventory.supplier) = 0,
  'a family sees neither stock nor suppliers');
RESET ROLE;

ROLLBACK;
