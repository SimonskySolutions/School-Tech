-- Each person's language (M9.1, ADR 0039).
BEGIN;
\ir _fixtures.sql
\echo '# 41 language'

SELECT test.as_person(:P);
UPDATE people.person SET preferred_locale = 'bg' WHERE id = app.current_person_id();
UPDATE people.person SET preferred_locale = 'bg' WHERE id = :Q;
SELECT test.expect_error(format('UPDATE people.person SET preferred_locale = ''de'' WHERE id = %L', :P), '23514',
  'only the languages the platform speaks');
RESET ROLE;
SELECT test.ok((SELECT preferred_locale FROM people.person WHERE id = :P) = 'bg', 'a parent chooses Bulgarian for themselves');
SELECT test.ok((SELECT preferred_locale FROM people.person WHERE id = :Q) IS NULL, 'but not for another parent');

SELECT test.as_person(:P);
UPDATE people.person SET preferred_locale = NULL WHERE id = app.current_person_id();
RESET ROLE;
SELECT test.ok((SELECT preferred_locale FROM people.person WHERE id = :P) IS NULL,
  'and can leave it to their browser again');

ROLLBACK;
