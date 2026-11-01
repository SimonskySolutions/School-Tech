-- migrate:up

-- M6 acceptance criterion 6, found in the M6.8 review: the people in a
-- project see its tasks, not only their own. Someone with a task in a project
-- now sees every task in it; tasks outside projects are unchanged (their
-- assignee, whoever set them, the school's leaders).
CREATE OR REPLACE FUNCTION work.may_read_task(p_task_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM work.task t LEFT JOIN work.project pr ON pr.id = t.project_id
     WHERE t.id = p_task_id AND t.group_id = access.current_group_id()
       AND (app.current_person_id() IN (t.assignee_person_id, t.created_by_person_id, pr.owner_person_id)
            OR access.has_permission('tasks.read', t.school_id)
            OR (t.project_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM work.task m
                   WHERE m.project_id = t.project_id AND m.assignee_person_id = app.current_person_id()))))
$$;

-- migrate:down
CREATE OR REPLACE FUNCTION work.may_read_task(p_task_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM work.task t LEFT JOIN work.project pr ON pr.id = t.project_id
     WHERE t.id = p_task_id AND t.group_id = access.current_group_id()
       AND (app.current_person_id() IN (t.assignee_person_id, t.created_by_person_id, pr.owner_person_id)
            OR access.has_permission('tasks.read', t.school_id)))
$$;
