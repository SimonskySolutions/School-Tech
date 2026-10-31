-- Transport routes, stops and seats for a term (M4.5).
BEGIN;
\ir _fixtures.sql
\echo '# 18 transport'
\set BUSD   '''50000000-0000-7000-8000-000000000018'''
\set BUSA   '''60000000-0000-7000-8000-000000000018'''
\set BUSA2  '''60000000-0000-7000-8000-000000000019'''
\set PBUS   '''70000000-0000-7000-8000-000000000018'''
\set PBUS2  '''70000000-0000-7000-8000-000000000019'''
\set STOP1  '''94000000-0000-7000-8000-000000000001'''
\set STOP2  '''94000000-0000-7000-8000-000000000002'''
\set STOPX  '''94000000-0000-7000-8000-000000000003'''
\set TERM   '''80000000-0000-7000-8000-000000000019'''

RESET ROLE;
INSERT INTO catalog.service_definition (id, group_id, code, kind, name) VALUES (:BUSD, :G, 'bus', 'transport', 'School bus');
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status) VALUES
  (:BUSA,  :G, :A, :BUSD, :E1, 'bus-1', 'Bus route 1', 'published'),
  (:BUSA2, :G, :A, :BUSD, :E1, 'bus-2', 'Bus route 2', 'published');
INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from) VALUES
  (:PBUS, :G, :BUSA, 1, 9000, 0, 'per_term', now() - interval '1 day'),
  (:PBUS2, :G, :BUSA2, 1, 9000, 0, 'per_term', now() - interval '1 day');
INSERT INTO scheduling.session (id, group_id, school_id, offering_id, starts_at, ends_at, capacity)
VALUES (:TERM, :G, :A, :BUSA, now() + interval '14 days', now() + interval '100 days', 1);

-- Routes and stops: only for transport, only by staff who manage the catalogue.
SELECT test.as_person(:ADM);
SELECT test.expect_error(format('INSERT INTO scheduling.transport_route (offering_id, group_id, school_id) VALUES (%L,%L,%L)', :CHA, :G, :A),
  '23514', 'a route is only for a transport offering');
INSERT INTO scheduling.transport_route (offering_id, group_id, school_id, vehicle) VALUES
  (:BUSA, :G, :A, 'Minibus (synthetic)'), (:BUSA2, :G, :A, 'Second bus (synthetic)');
SELECT test.expect_error(format('INSERT INTO scheduling.transport_route (offering_id, group_id, school_id, weekdays) VALUES (%L,%L,%L,%L)', :CHA, :G, :A, '{8}'),
  '23514', 'weekdays are 1 to 7');
INSERT INTO scheduling.transport_stop (id, group_id, school_id, offering_id, position, name, pickup_time, dropoff_time) VALUES
  (:STOP1, :G, :A, :BUSA, 1, 'First stop (synthetic)', TIME '07:20', TIME '16:40'),
  (:STOP2, :G, :A, :BUSA, 2, 'Second stop (synthetic)', TIME '07:35', TIME '16:25'),
  (:STOPX, :G, :A, :BUSA2, 1, 'Other route stop (synthetic)', TIME '07:30', NULL);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.transport_stop (group_id, school_id, offering_id, position, name, pickup_time) VALUES (%L,%L,%L,1,%L,%L)',
  :G, :A, :BUSA, 'Duplicate position', '07:00'), '23505', 'two stops cannot share a position on a route');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.transport_stop (group_id, school_id, offering_id, position, name, pickup_time) VALUES (%L,%L,%L,3,%L,%L)',
  :G, :A, :BUSA, 'Sneaky stop', '07:00'), '42501', 'a teacher cannot add stops');

-- A seat needs one of its own route's active stops.
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM scheduling.transport_stop WHERE offering_id = :BUSA) = 2, 'a parent sees the route''s stops');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id) VALUES (%L,%L,%L,%L,%L,now() + interval %L,%L)',
  :G, :A, :TERM, :K1, 'reserved', '30 minutes', :P), 'PY018', 'a seat without a stop is refused');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id, transport_stop_id) VALUES (%L,%L,%L,%L,%L,now() + interval %L,%L,%L)',
  :G, :A, :TERM, :K1, 'reserved', '30 minutes', :P, :STOPX), 'PY018', 'a stop of another route is refused');
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id, transport_stop_id) VALUES (%L,%L,%L,%L,%L,now() + interval %L,%L,%L)',
  :G, :A, :SLA, :K1, 'reserved', '30 minutes', :P, :STOP1), 'PY018', 'only transport seats have a stop');
RESET ROLE;
UPDATE scheduling.transport_stop SET status = 'retired' WHERE id = :STOP2;
SELECT test.as_person(:P);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id, transport_stop_id) VALUES (%L,%L,%L,%L,%L,now() + interval %L,%L,%L)',
  :G, :A, :TERM, :K1, 'reserved', '30 minutes', :P, :STOP2), 'PY018', 'a stop no longer served is refused');

INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id, transport_stop_id)
VALUES (:G, :A, :TERM, :K1, 'reserved', now() + interval '30 minutes', :P, :STOP1);
SELECT test.ok((SELECT transport_stop_id FROM scheduling.booking WHERE session_id = :TERM) = :STOP1::uuid,
  'the seat records the child''s stop');

-- The last seat is gone: another family is refused.
RESET ROLE; SELECT test.as_person(:Q);
SELECT test.expect_error(format(
  'INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id, transport_stop_id) VALUES (%L,%L,%L,%L,%L,now() + interval %L,%L,%L)',
  :G, :A, :TERM, :K3, 'reserved', '30 minutes', :Q, :STOP1), 'PY002', 'a full route refuses the next seat');

RESET ROLE;
ROLLBACK;
