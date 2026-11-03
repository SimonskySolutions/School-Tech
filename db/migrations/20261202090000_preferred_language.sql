-- migrate:up

-- The languages the platform speaks (M9.1, ADR 0039). people.person has had
-- preferred_locale since M0, for any locale; no release has written it. Now it
-- holds a person's own choice of Bulgarian or English, or nothing, when their
-- browser decides. A person sets it for themselves through the update policy
-- they already have (update_self_or_managed).

UPDATE people.person
   SET preferred_locale = CASE WHEN left(preferred_locale, 2) IN ('bg', 'en') THEN left(preferred_locale, 2) END
 WHERE preferred_locale IS NOT NULL AND preferred_locale NOT IN ('bg', 'en');
ALTER TABLE people.person DROP CONSTRAINT person_preferred_locale_check;
ALTER TABLE people.person ADD CONSTRAINT person_preferred_locale_check CHECK (preferred_locale IN ('bg', 'en'));
COMMENT ON COLUMN people.person.preferred_locale IS
  'The language the person chose for the portal and their e-mails: bg or en; NULL lets their browser decide';

-- migrate:down
COMMENT ON COLUMN people.person.preferred_locale IS NULL;
ALTER TABLE people.person DROP CONSTRAINT person_preferred_locale_check;
ALTER TABLE people.person ADD CONSTRAINT person_preferred_locale_check
  CHECK (preferred_locale ~ '^[a-z]{2}(-[A-Z]{2})?$');
