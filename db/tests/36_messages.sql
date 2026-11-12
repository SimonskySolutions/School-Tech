-- Messages for staff and families (M7.2, ADR 0031).
BEGIN;
\ir _fixtures.sql
\echo '# 36 messages for staff and families'

CREATE TEMP TABLE m (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON m TO pyth_api, pyth_worker;
CREATE FUNCTION pg_temp.id(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM m WHERE name = p $$;
CREATE FUNCTION pg_temp.events(p_type text, p_aggregate uuid) RETURNS bigint LANGUAGE sql
AS $$ SELECT count(*) FROM integration.outbox_event WHERE event_type = p_type AND aggregate_id = p_aggregate $$;
CREATE FUNCTION pg_temp.told(p_kind text) RETURNS uuid[] LANGUAGE sql
AS $$ SELECT coalesce(array_agg(person_id ORDER BY person_id), '{}') FROM notify.message WHERE kind_code = p_kind $$;
\set WEB '''b1000000-0000-7000-8000-000000000201'''

-- An approval: whoever holds the waiting step's role is told, step by step.
SELECT test.as_person(:PRA);
INSERT INTO m SELECT 'policy', documents.create_document('school', :A, NULL, 'Behaviour policy (synthetic)', 'policy', true);
INSERT INTO m SELECT 'v1', version_id FROM documents.add_version(pg_temp.id('policy'), 'p.pdf', 'application/pdf', 10, sha256('1'::bytea));
INSERT INTO m SELECT 'r1', documents.request_approval(pg_temp.id('v1'), ARRAY['principal', 'group_ceo']);
RESET ROLE;
SELECT test.ok(pg_temp.events('documents.approval.advanced', pg_temp.id('r1')) = 1, 'asking for approval notes one event');
SELECT test.ok(NOT EXISTS (SELECT 1 FROM integration.outbox_event WHERE aggregate_id = pg_temp.id('r1')
                             AND payload::text ~* 'behaviour|policy'),
  'with identifiers only');
SELECT test.as_worker();
SELECT test.ok(notify.on_approval_advanced(pg_temp.id('r1')) = 1 AND pg_temp.told('approval.waiting') = ARRAY[:PRA::uuid],
  'the principal is told the first step waits for them');
SELECT test.ok((SELECT params ->> 'title' = 'Behaviour policy (synthetic)' AND params ->> 'schoolName' = 'School A'
                  FROM notify.message WHERE kind_code = 'approval.waiting'),
  'with the document''s title and school');
SELECT test.ok(notify.on_approval_advanced(pg_temp.id('r1')) = 0, 'once');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT documents.decide_step((SELECT id FROM documents.approval_step WHERE request_id = pg_temp.id('r1') AND step_no = 1), 'approved', NULL);
RESET ROLE; SELECT test.as_worker();
SELECT notify.on_approval_advanced(pg_temp.id('r1'));
SELECT test.ok(pg_temp.told('approval.waiting') = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[:PRA::uuid, :CEO::uuid]) x),
  'then the CEO, not the group administrator');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT documents.decide_step((SELECT id FROM documents.approval_step WHERE request_id = pg_temp.id('r1') AND step_no = 2), 'approved', NULL);
RESET ROLE; SELECT test.as_worker();
SELECT test.ok(notify.on_approval_advanced(pg_temp.id('r1')) = 0, 'and nobody once it is approved');

-- Someone holding two roles is not asked for the second step after deciding the first.
RESET ROLE;
INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id) VALUES (:G, :CEO, 'group_admin', NULL);
SELECT test.as_person(:PRA);
INSERT INTO m SELECT 'v2', version_id FROM documents.add_version(pg_temp.id('policy'), 'p2.pdf', 'application/pdf', 10, sha256('2'::bytea));
INSERT INTO m SELECT 'r2', documents.request_approval(pg_temp.id('v2'), ARRAY['group_admin', 'group_ceo']);
RESET ROLE; SELECT test.as_worker();
SELECT test.ok(notify.on_approval_advanced(pg_temp.id('r2')) = 2, 'both group administrators are told of the first step');
RESET ROLE; SELECT test.as_person(:CEO);
SELECT documents.decide_step((SELECT id FROM documents.approval_step WHERE request_id = pg_temp.id('r2') AND step_no = 1), 'approved', NULL);
RESET ROLE; SELECT test.as_worker();
SELECT test.ok(notify.on_approval_advanced(pg_temp.id('r2')) = 0, 'the CEO who decided it is not asked for the next');

-- Tasks: told when someone else gives one, or hands one on.
RESET ROLE; SELECT test.as_person(:PRA);
INSERT INTO m SELECT 'menu', work.create_task(:A, NULL, 'Plan the menu (synthetic)', NULL, current_date + 3, :KITA);
INSERT INTO m SELECT 'own', work.create_task(:A, NULL, 'Call the printer (synthetic)', NULL, NULL, :PRA);
RESET ROLE;
SELECT test.ok(pg_temp.events('work.task.assigned', pg_temp.id('menu')) = 1 AND pg_temp.events('work.task.assigned', pg_temp.id('own')) = 0,
  'a task for the kitchen is noted, the principal''s own is not');
SELECT test.as_worker();
SELECT test.ok(notify.on_task_assigned(pg_temp.id('menu'), :KITA) = 1 AND pg_temp.told('task.assigned') = ARRAY[:KITA::uuid],
  'the kitchen is told');
SELECT test.ok((SELECT params ->> 'setBy' = 'Petar Principal' AND params ->> 'dueOn' = (current_date + 3)::text
                  FROM notify.message WHERE kind_code = 'task.assigned'),
  'who set it and when it is due');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT work.update_task(pg_temp.id('menu'), 'Plan the menu (synthetic)', NULL, current_date + 3, :PRA);
RESET ROLE;
SELECT test.ok(pg_temp.events('work.task.assigned', pg_temp.id('menu')) = 1, 'taking a task back oneself tells nobody');
SELECT test.as_worker();
SELECT test.ok(notify.on_task_assigned(pg_temp.id('menu'), :KITA) = 0, 'and an old event about it tells nobody either');

-- A reply from the school tells the family; the family's own messages do not.
RESET ROLE; SELECT test.as_person(:P);
INSERT INTO m SELECT 'request', people.open_family_request(:K1, :A, 'dietary', 'Kid cannot eat nuts any more', 'From Monday, please.');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT people.reply_to_family_request(pg_temp.id('request'), 'Noted, thank you.');
RESET ROLE; SELECT test.as_person(:P);
SELECT people.reply_to_family_request(pg_temp.id('request'), 'Thank you!');
RESET ROLE;
SELECT test.ok(pg_temp.events('people.family_request.answered', pg_temp.id('request')) = 1, 'only the school''s reply is noted');
SELECT test.as_worker();
SELECT test.ok(notify.on_request_answered(pg_temp.id('request'),
                 (SELECT (payload ->> 'message_id')::uuid FROM integration.outbox_event
                   WHERE event_type = 'people.family_request.answered' AND aggregate_id = pg_temp.id('request'))) = 1
               AND pg_temp.told('request.answered') = ARRAY[:P::uuid],
  'the parent who asked is told');
SELECT test.ok((SELECT params::text !~* 'nuts|monday|noted' FROM notify.message WHERE kind_code = 'request.answered'),
  'without the subject or the reply');

-- New wording that asks again tells each guardian whose consent stopped counting.
RESET ROLE;
UPDATE people.guardian_relationship SET can_consent = true WHERE guardian_person_id = :P AND student_person_id = :K1;
SELECT test.as_person(:DPO);
INSERT INTO privacy.processing_purpose (id, group_id, code, name, description, lawful_basis) VALUES
  (:WEB, :G, 'photos.website', 'Photos on the website', 'Photos of pupils on the school website', 'consent');
UPDATE privacy.processing_purpose SET status = 'approved', approved_by_person_id = :DPO, approved_at = now() WHERE id = :WEB;
SELECT privacy.publish_wording(:WEB, 'We may publish photos of your child (synthetic).', false);
RESET ROLE; SELECT test.as_person(:P);
SELECT privacy.give_consent(:K1, :WEB, privacy.current_wording(:WEB));
RESET ROLE; SELECT test.as_person(:DPO);
INSERT INTO m SELECT 'fix', privacy.publish_wording(:WEB, 'We may publish photos of your child on the website (synthetic).', false);
INSERT INTO m SELECT 'renew', privacy.publish_wording(:WEB, 'We may publish photos and first names of your child (synthetic).', true);
RESET ROLE;
SELECT test.ok(pg_temp.events('privacy.consent_wording.renewal', pg_temp.id('fix')) = 0
               AND pg_temp.events('privacy.consent_wording.renewal', pg_temp.id('renew')) = 1,
  'a correction is not noted, a change of substance is');
SELECT test.as_worker();
SELECT test.ok(notify.on_wording_renewal(pg_temp.id('renew')) = 1 AND pg_temp.told('consent.asked_again') = ARRAY[:P::uuid],
  'the guardian who may consent is told, not the one waiting to be verified');
SELECT test.ok(notify.on_wording_renewal(pg_temp.id('renew')) = 0, 'once');
RESET ROLE;

ROLLBACK;
