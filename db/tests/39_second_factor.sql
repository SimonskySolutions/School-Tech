-- Who must sign in with a second factor (M8.3, ADR 0034).
BEGIN;
\ir _fixtures.sql
\echo '# 39 second factor for staff'

SET LOCAL ROLE pyth_api;
SELECT test.ok(access.requires_second_factor(:ADM), 'a group administrator needs a second factor');
SELECT test.ok(access.requires_second_factor(:PRA), 'so does a principal, whose role is at one school');
SELECT test.ok(NOT access.requires_second_factor(:P), 'a parent does not');
SELECT test.ok(NOT access.requires_second_factor(:K1), 'nor a child');
RESET ROLE;

UPDATE access.role_assignment SET revoked_at = now() WHERE person_id = :TEAB;
UPDATE access.role_assignment SET valid_until = now() - interval '1 day', valid_from = now() - interval '2 days'
 WHERE person_id = :KITA;
INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id, valid_from)
VALUES (:G, :Q, 'teacher', :B, now() + interval '1 day');

SET LOCAL ROLE pyth_api;
SELECT test.ok(NOT access.requires_second_factor(:TEAB), 'not once the only role is revoked');
SELECT test.ok(NOT access.requires_second_factor(:KITA), 'nor once it has ended');
SELECT test.ok(NOT access.requires_second_factor(:Q), 'nor before it begins');
RESET ROLE;

SET LOCAL ROLE pyth_worker;
SELECT test.expect_error('SELECT access.requires_second_factor(gen_random_uuid())', '42501',
  'only the API may ask');
RESET ROLE;

ROLLBACK;
