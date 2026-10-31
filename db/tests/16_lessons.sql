-- Individual lessons: teachers and rooms, slots, packages and cancellation (M4.3).
BEGIN;
\ir _fixtures.sql
\echo '# 16 individual lessons'
\set LESSOND '''50000000-0000-7000-8000-000000000016'''
\set PIANO   '''60000000-0000-7000-8000-000000000016'''
\set PPIANO  '''70000000-0000-7000-8000-000000000016'''
\set TEACH   '''91000000-0000-7000-8000-000000000001'''
\set TEACH2  '''91000000-0000-7000-8000-000000000002'''
\set ROOM    '''91000000-0000-7000-8000-000000000003'''
\set OPK     '''92000000-0000-7000-8000-000000000001'''
\set LPK     '''92000000-0000-7000-8000-000000000002'''

RESET ROLE;
INSERT INTO catalog.service_definition (id, group_id, code, kind, name) VALUES (:LESSOND, :G, 'piano', 'lesson', 'Piano lessons');
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status)
VALUES (:PIANO, :G, :A, :LESSOND, :E1, 'piano', 'Piano, 2 lessons', 'published');
INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, package_size, valid_from)
VALUES (:PPIANO, :G, :PIANO, 1, 5000, 0, 'per_package', 2, now() - interval '1 day');

-- Teachers and rooms: only staff who manage the catalogue add them.
SELECT test.as_person(:TEAB);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.resource (group_id, school_id, kind, display_name) VALUES (%L,%L,%L,%L)', :G, :A, 'room', 'Sneaky room'),
  '42501', 'a teacher cannot add rooms');
RESET ROLE; SELECT test.as_person(:ADM);
INSERT INTO scheduling.resource (id, group_id, school_id, kind, display_name) VALUES
  (:TEACH, :G, :A, 'teacher', 'Ms Piano (synthetic)'),
  (:TEACH2, :G, :A, 'teacher', 'Mr Keys (synthetic)'),
  (:ROOM, :G, :A, 'room', 'Music room (synthetic)');
-- Teachers 15:00-17:00, the room 16:00-18:00, on school days: one shared hour a day.
INSERT INTO scheduling.resource_availability (group_id, school_id, resource_id, weekday, starts, ends)
SELECT :G, :A, r, d, s, e FROM unnest(ARRAY[:TEACH, :TEACH2, :ROOM]::uuid[]) r,
       generate_series(1, 5) d,
       LATERAL (SELECT CASE WHEN r = :ROOM::uuid THEN TIME '16:00' ELSE TIME '15:00' END,
                       CASE WHEN r = :ROOM::uuid THEN TIME '18:00' ELSE TIME '17:00' END) t (s, e);

CREATE TEMP TABLE expect ON COMMIT DROP AS
SELECT count(*)::int AS days FROM generate_series(current_date + 3, current_date + 16, interval '1 day') g WHERE extract(isodow FROM g) < 6;
GRANT SELECT ON expect TO pyth_api;

SELECT test.ok(scheduling.create_lesson_slots(:PIANO, :TEACH, :ROOM, current_date + 3, current_date + 16, 60) = (SELECT days FROM expect),
  'slots fill the shared hour of the teacher and the room on each school day');
SELECT test.ok(scheduling.create_lesson_slots(:PIANO, :TEACH, :ROOM, current_date + 3, current_date + 16, 60) = 0,
  'creating the same slots again creates none');
SELECT test.ok(scheduling.create_lesson_slots(:PIANO, :TEACH2, :ROOM, current_date + 3, current_date + 16, 60) = 0,
  'another teacher cannot have the room when it is taken');
SELECT test.ok((SELECT count(*) FROM scheduling.session s JOIN scheduling.session_resource r ON r.session_id = s.id
                WHERE s.offering_id = :PIANO AND s.capacity = 1 AND r.resource_id = :TEACH
                  AND s.cancellation_cutoff_at = s.starts_at - interval '24 hours') = (SELECT days FROM expect),
  'each slot has one place, its teacher, and a cutoff 24 hours before');

-- The guarantees hold for any writer, not only the slot function.
RESET ROLE;
CREATE TEMP TABLE slot ON COMMIT DROP AS
SELECT s.id, s.starts_at, s.ends_at, row_number() OVER (ORDER BY s.starts_at) AS n
  FROM scheduling.session s WHERE s.offering_id = :PIANO;
GRANT SELECT ON slot TO pyth_api;
INSERT INTO scheduling.session (id, group_id, school_id, offering_id, starts_at, ends_at, capacity)
SELECT '93000000-0000-7000-8000-000000000001', :G, :A, :PIANO, starts_at + interval '30 minutes', ends_at + interval '30 minutes', 1
  FROM slot WHERE n = 1;
SELECT test.expect_error(format(
  'INSERT INTO scheduling.session_resource (session_id, resource_id, group_id, school_id, during) SELECT %L, %L, %L, %L, tstzrange(starts_at + interval ''30 minutes'', ends_at + interval ''30 minutes'') FROM slot WHERE n = 1',
  '93000000-0000-7000-8000-000000000001', :TEACH2, :G, :A), 'PY015', 'a slot outside the teacher''s hours is refused');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.session_resource (session_id, resource_id, group_id, school_id, during) SELECT %L, %L, %L, %L, tstzrange(starts_at - interval ''30 minutes'', ends_at - interval ''30 minutes'') FROM slot WHERE n = 1',
  '93000000-0000-7000-8000-000000000001', :TEACH, :G, :A), '23P01', 'a teacher can never be in two overlapping slots');

-- A cancelled slot frees its teacher and room.
UPDATE scheduling.session SET status = 'cancelled' WHERE id = (SELECT id FROM slot WHERE n = (SELECT days FROM expect));
SELECT test.ok(NOT (SELECT bool_or(active) FROM scheduling.session_resource WHERE session_id = (SELECT id FROM slot WHERE n = (SELECT days FROM expect))),
  'cancelling a slot releases its teacher and room');
SELECT test.as_person(:ADM);
SELECT test.ok(scheduling.create_lesson_slots(:PIANO, :TEACH2, :ROOM, current_date + 3, current_date + 16, 60) = 1,
  'the freed hour can be given to another teacher');

-- A paid package line becomes the child's package with its lessons.
RESET ROLE;
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id)
VALUES (:OPK, :G, :E1, :P, 'family_portal', 'test-idem-1601', :P);
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
VALUES (:LPK, :G, :OPK, :E1, 1, :A, :PIANO, :K1, :PPIANO, 'Piano, 2 lessons', 1, 'EUR', 5000, 0, 5000);
UPDATE commerce.order_line SET status = 'confirmed' WHERE id = :LPK;
SELECT test.ok((SELECT lessons_bought = 2 AND scheduling.package_balance(id) = 2 FROM scheduling.lesson_package WHERE order_line_id = :LPK),
  'confirming the paid line gives the child a package of 2 lessons');
CREATE TEMP TABLE pkg ON COMMIT DROP AS SELECT id FROM scheduling.lesson_package WHERE order_line_id = :LPK;
GRANT SELECT ON pkg TO pyth_api;

-- Booking spends one lesson; nobody else can spend it.
SELECT test.as_person(:Q);
SELECT test.expect_error(format('SELECT scheduling.book_lesson((SELECT id FROM slot WHERE n = 1), %L, (SELECT id FROM pkg))', :K1),
  'P0002', 'another parent cannot use the package');
SELECT test.ok((SELECT count(*) FROM scheduling.lesson_package) = 0, 'another parent does not see the package');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.expect_error(format('SELECT scheduling.book_lesson(%L, %L, (SELECT id FROM pkg))', :SCHA, :K1),
  '23503', 'the package is only for its own lesson slots');
SELECT scheduling.book_lesson((SELECT id FROM slot WHERE n = 1), :K1, (SELECT id FROM pkg));
SELECT scheduling.book_lesson((SELECT id FROM slot WHERE n = 2), :K1, (SELECT id FROM pkg));
SELECT test.ok(scheduling.package_balance((SELECT id FROM pkg)) = 0, 'two bookings spend both lessons');
SELECT test.ok((SELECT count(*) FROM scheduling.booking b JOIN slot ON slot.id = b.session_id WHERE b.status = 'confirmed') = 2,
  'the bookings are confirmed at once, with no payment of their own');
SELECT test.expect_error(format('SELECT scheduling.book_lesson((SELECT id FROM slot WHERE n = 3), %L, (SELECT id FROM pkg))', :K1),
  'PY014', 'an empty package books nothing');

-- Cancelling: before the cutoff the lesson comes back, after it the lesson is used.
SELECT test.ok(scheduling.cancel_lesson((SELECT b.id FROM scheduling.booking b JOIN slot ON slot.id = b.session_id WHERE slot.n = 1)) = 'returned',
  'cancelling before the cutoff returns the lesson');
SELECT test.ok(scheduling.package_balance((SELECT id FROM pkg)) = 1, 'the package has one lesson again');
RESET ROLE;
UPDATE scheduling.session SET cancellation_cutoff_at = now() - interval '1 minute' WHERE id = (SELECT id FROM slot WHERE n = 2);
SELECT test.as_person(:P);
SELECT test.ok(scheduling.cancel_lesson((SELECT b.id FROM scheduling.booking b JOIN slot ON slot.id = b.session_id WHERE slot.n = 2)) = 'used',
  'cancelling after the cutoff: the lesson counts as used');
SELECT test.ok(scheduling.package_balance((SELECT id FROM pkg)) = 1, 'and is not returned');
SELECT test.ok((SELECT confirmed_count FROM scheduling.session WHERE id = (SELECT id FROM slot WHERE n = 2)) = 0,
  'the slot is free again for someone else');
SELECT test.ok((SELECT count(*) FROM scheduling.package_entry WHERE package_id = (SELECT id FROM pkg)) = 4,
  'the parent sees every entry of the package''s ledger');
SELECT scheduling.book_lesson((SELECT id FROM slot WHERE n = 2), :K1, (SELECT id FROM pkg));
SELECT test.ok(scheduling.package_balance((SELECT id FROM pkg)) = 0, 'the freed slot can be booked again');

RESET ROLE;
SELECT test.expect_error('UPDATE scheduling.package_entry SET delta = 5', 'PY004', 'the package ledger is permanent');
SELECT test.expect_error('DELETE FROM scheduling.package_entry', 'PY004', 'ledger entries cannot be deleted');

ROLLBACK;
