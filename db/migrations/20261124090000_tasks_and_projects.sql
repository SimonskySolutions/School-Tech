-- migrate:up

-- Tasks and projects (M6.7): a task has an assignee, perhaps a due date, and
-- a state; it stands alone or belongs to a project of a school or of the
-- group. Seen by those involved (the assignee, whoever set it, the project's
-- owner) and the leaders of its school (tasks.read); leaders assign work to
-- the people who work there (tasks.assign), and everyone keeps their own
-- to-do list. Only people who work in the group take part: never parents or
-- children. Every write goes through the functions.

CREATE SCHEMA work;
REVOKE ALL ON SCHEMA work FROM PUBLIC;
GRANT USAGE ON SCHEMA work TO pyth_api;

INSERT INTO access.permission (code, description) VALUES
  ('tasks.read', 'See the tasks and projects of the school'),
  ('tasks.assign', 'Start projects and give tasks to the people who work at the school');
INSERT INTO access.role_permission (role_code, permission_code) VALUES
  ('group_ceo', 'tasks.read'), ('group_admin', 'tasks.read'), ('principal', 'tasks.read'), ('school_admin', 'tasks.read'),
  ('group_ceo', 'tasks.assign'), ('group_admin', 'tasks.assign'), ('principal', 'tasks.assign'),
  ('school_admin', 'tasks.assign');

CREATE TABLE work.project (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  -- A school's project, or the group's (no school).
  school_id             uuid,
  name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description           text CHECK (length(description) BETWEEN 1 AND 2000),
  owner_person_id       uuid NOT NULL REFERENCES people.person (id),
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  UNIQUE (id, group_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX project_school_idx ON work.project (school_id);
CREATE INDEX project_owner_idx ON work.project (owner_person_id);

CREATE TABLE work.task (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id              uuid NOT NULL,
  project_id            uuid,
  -- The school the task is for (its project's school), or the group.
  school_id             uuid,
  title                 text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  details               text CHECK (length(details) BETWEEN 1 AND 4000),
  assignee_person_id    uuid NOT NULL REFERENCES people.person (id),
  created_by_person_id  uuid NOT NULL REFERENCES people.person (id),
  due_on                date,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, group_id) REFERENCES work.project (id, group_id),
  FOREIGN KEY (school_id, group_id) REFERENCES org.school (id, group_id),
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX task_assignee_idx ON work.task (assignee_person_id, status, due_on);
CREATE INDEX task_created_by_idx ON work.task (created_by_person_id);
CREATE INDEX task_project_idx ON work.task (project_id);
CREATE INDEX task_school_open_idx ON work.task (school_id, due_on) WHERE status IN ('open', 'in_progress');

INSERT INTO meta.state_transition (machine, from_state, to_state) VALUES
  ('task', 'open', 'in_progress'), ('task', 'in_progress', 'open'),
  ('task', 'open', 'done'), ('task', 'in_progress', 'done'), ('task', 'done', 'open'),
  ('task', 'open', 'cancelled'), ('task', 'in_progress', 'cancelled'),
  ('project', 'active', 'closed');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON work.task
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('task');
CREATE TRIGGER enforce_transition BEFORE UPDATE OF status ON work.project
  FOR EACH ROW EXECUTE FUNCTION app.enforce_transition('project');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON work.task FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON work.project FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON work.task FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON work.project FOR EACH ROW EXECUTE FUNCTION audit.log_change();

-- Does the person work here now: at the school, or (no school) anywhere in the group?
CREATE FUNCTION work.works_in(p_person_id uuid, p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM people.person p
                  WHERE p.id = p_person_id AND p.status = 'active' AND p.group_id = access.current_group_id())
     AND CASE WHEN p_school_id IS NOT NULL THEN p_school_id IN (SELECT staff.current_schools(p_person_id))
         ELSE EXISTS (SELECT staff.current_schools(p_person_id))
              OR EXISTS (SELECT 1 FROM access.role_assignment ra
                          WHERE ra.person_id = p_person_id AND ra.school_id IS NULL AND ra.revoked_at IS NULL
                            AND (ra.valid_until IS NULL OR ra.valid_until > now()))
              OR EXISTS (SELECT 1 FROM staff.employment e
                          WHERE e.person_id = p_person_id AND e.school_id IS NULL
                            AND e.start_date <= current_date AND (e.end_date IS NULL OR e.end_date >= current_date)) END
$$;
REVOKE ALL ON FUNCTION work.works_in(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.works_in(uuid, uuid) TO pyth_api;

-- May the signed-in person give this person a task here: themselves, if they
-- work here, or anyone who works here, with tasks.assign (or as the owner of
-- the task's project).
CREATE FUNCTION work.may_assign(p_school_id uuid, p_assignee_id uuid, p_project_owner_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL AND work.works_in(p_assignee_id, p_school_id)
     AND (p_assignee_id = app.current_person_id() OR p_project_owner_id = app.current_person_id()
          OR access.has_permission('tasks.assign', p_school_id))
$$;
REVOKE ALL ON FUNCTION work.may_assign(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.may_assign(uuid, uuid, uuid) TO pyth_api;

-- Who sees a task: its assignee, whoever set it, its project's owner, the school's leaders.
CREATE FUNCTION work.may_read_task(p_task_id uuid) RETURNS boolean
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
REVOKE ALL ON FUNCTION work.may_read_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.may_read_task(uuid) TO pyth_api;

-- Who changes a task beyond its state: whoever set it, the project's owner, tasks.assign there.
CREATE FUNCTION work.may_manage_task(p_task_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM work.task t LEFT JOIN work.project pr ON pr.id = t.project_id
     WHERE t.id = p_task_id AND t.group_id = access.current_group_id()
       AND (app.current_person_id() IN (t.created_by_person_id, pr.owner_person_id)
            OR access.has_permission('tasks.assign', t.school_id)))
$$;
REVOKE ALL ON FUNCTION work.may_manage_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.may_manage_task(uuid) TO pyth_api;

-- Who sees a project: its owner, anyone with a task in it, the school's leaders.
CREATE FUNCTION work.may_read_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT app.current_person_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM work.project pr
     WHERE pr.id = p_project_id AND pr.group_id = access.current_group_id()
       AND (pr.owner_person_id = app.current_person_id() OR access.has_permission('tasks.read', pr.school_id)
            OR EXISTS (SELECT 1 FROM work.task t WHERE t.project_id = pr.id AND t.assignee_person_id = app.current_person_id())))
$$;
REVOKE ALL ON FUNCTION work.may_read_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.may_read_project(uuid) TO pyth_api;

-- A school's leaders (or the group's) start a project, which they own.
CREATE FUNCTION work.create_project(p_school_id uuid, p_name text, p_description text) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF app.current_person_id() IS NULL OR NOT access.has_permission('tasks.assign', p_school_id) THEN
    RAISE EXCEPTION 'not yours to start' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO work.project (group_id, school_id, name, description, owner_person_id)
  VALUES (access.current_group_id(), p_school_id, btrim(p_name), nullif(btrim(p_description), ''), app.current_person_id())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION work.create_project(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.create_project(uuid, text, text) TO pyth_api;

-- Closed by its owner or the school's leaders, once nothing is left to do in it.
CREATE FUNCTION work.close_project(p_project_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pr record;
BEGIN
  SELECT * INTO pr FROM work.project WHERE id = p_project_id AND group_id = access.current_group_id() FOR UPDATE;
  IF NOT FOUND OR NOT (pr.owner_person_id = app.current_person_id() OR access.has_permission('tasks.assign', pr.school_id)) THEN
    RAISE EXCEPTION 'no such project' USING ERRCODE = 'P0002';
  END IF;
  IF pr.status <> 'active' THEN
    RAISE EXCEPTION 'the project is already closed' USING ERRCODE = 'PY001';
  END IF;
  IF EXISTS (SELECT 1 FROM work.task WHERE project_id = pr.id AND status IN ('open', 'in_progress')) THEN
    RAISE EXCEPTION 'tasks are still open in the project' USING ERRCODE = 'PY001';
  END IF;
  UPDATE work.project SET status = 'closed', closed_at = now() WHERE id = pr.id;
END $$;
REVOKE ALL ON FUNCTION work.close_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.close_project(uuid) TO pyth_api;

-- A task, alone (for a school or the group) or in an active project (for its school).
CREATE FUNCTION work.create_task(
  p_school_id uuid, p_project_id uuid, p_title text, p_details text, p_due_on date, p_assignee_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pr record;
  v_school uuid := p_school_id;
  v_owner uuid;
  v_id uuid;
BEGIN
  IF p_project_id IS NOT NULL THEN
    SELECT * INTO pr FROM work.project WHERE id = p_project_id AND group_id = access.current_group_id() FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no such project' USING ERRCODE = 'P0002';
    END IF;
    IF pr.status <> 'active' THEN
      RAISE EXCEPTION 'the project is closed' USING ERRCODE = 'PY001';
    END IF;
    IF p_school_id IS DISTINCT FROM pr.school_id THEN
      RAISE EXCEPTION 'a project''s task is for the project''s school' USING ERRCODE = '23514';
    END IF;
    v_owner := pr.owner_person_id;
    -- In a project, only its owner and the school's leaders give tasks.
    IF NOT (v_owner = app.current_person_id() OR access.has_permission('tasks.assign', v_school)) THEN
      RAISE EXCEPTION 'no such project' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  IF NOT coalesce(work.may_assign(v_school, p_assignee_id, v_owner), false) THEN
    RAISE EXCEPTION 'not someone you give tasks to here' USING ERRCODE = 'P0002';
  END IF;
  IF p_due_on < current_date THEN
    RAISE EXCEPTION 'a task is not due in the past' USING ERRCODE = '23514';
  END IF;
  INSERT INTO work.task (group_id, project_id, school_id, title, details, assignee_person_id, created_by_person_id, due_on)
  VALUES (access.current_group_id(), p_project_id, v_school, btrim(p_title), nullif(btrim(p_details), ''), p_assignee_id,
          app.current_person_id(), p_due_on)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION work.create_task(uuid, uuid, text, text, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.create_task(uuid, uuid, text, text, date, uuid) TO pyth_api;

-- The assignee and those who manage the task move it along.
CREATE FUNCTION work.set_task_status(p_task_id uuid, p_status text) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  t record;
BEGIN
  SELECT * INTO t FROM work.task WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND OR NOT (t.assignee_person_id = app.current_person_id() OR work.may_manage_task(t.id)) THEN
    RAISE EXCEPTION 'no such task' USING ERRCODE = 'P0002';
  END IF;
  IF t.status = p_status THEN
    RAISE EXCEPTION 'the task is already %', p_status USING ERRCODE = 'PY001';
  END IF;
  IF p_status = 'cancelled' AND NOT work.may_manage_task(t.id) THEN
    RAISE EXCEPTION 'only whoever set the task cancels it' USING ERRCODE = 'P0002';
  END IF;
  UPDATE work.task SET status = p_status, completed_at = CASE WHEN p_status = 'done' THEN now() END WHERE id = t.id;
END $$;
REVOKE ALL ON FUNCTION work.set_task_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.set_task_status(uuid, text) TO pyth_api;

-- Whoever manages a task changes its title, details, due date or assignee
-- while it is still to do.
CREATE FUNCTION work.update_task(p_task_id uuid, p_title text, p_details text, p_due_on date, p_assignee_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  t record;
  v_owner uuid;
BEGIN
  SELECT * INTO t FROM work.task WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND OR NOT work.may_manage_task(t.id) THEN
    RAISE EXCEPTION 'no such task' USING ERRCODE = 'P0002';
  END IF;
  IF t.status NOT IN ('open', 'in_progress') THEN
    RAISE EXCEPTION 'a finished task is not changed' USING ERRCODE = 'PY001';
  END IF;
  SELECT owner_person_id INTO v_owner FROM work.project WHERE id = t.project_id;
  IF p_assignee_id IS DISTINCT FROM t.assignee_person_id
     AND NOT coalesce(work.may_assign(t.school_id, p_assignee_id, v_owner), false) THEN
    RAISE EXCEPTION 'not someone you give tasks to here' USING ERRCODE = 'P0002';
  END IF;
  IF p_due_on IS DISTINCT FROM t.due_on AND p_due_on < current_date THEN
    RAISE EXCEPTION 'a task is not due in the past' USING ERRCODE = '23514';
  END IF;
  UPDATE work.task SET title = btrim(p_title), details = nullif(btrim(p_details), ''), due_on = p_due_on,
                       assignee_person_id = p_assignee_id
   WHERE id = t.id;
END $$;
REVOKE ALL ON FUNCTION work.update_task(uuid, text, text, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.update_task(uuid, text, text, date, uuid) TO pyth_api;

-- The tasks the signed-in person may see, with names of those involved: a
-- colleague's name is shown with the work they share, whatever else they may read.
CREATE FUNCTION work.visible_tasks()
RETURNS TABLE (id uuid, project_id uuid, project_name text, school_id uuid, school_name text, title text, details text,
               assignee_person_id uuid, assignee_name text, created_by_person_id uuid, created_by_name text,
               due_on date, status text, completed_at timestamptz, created_at timestamptz, overdue boolean,
               may_manage boolean)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT t.id, t.project_id, pr.name, t.school_id, s.name, t.title, t.details,
         t.assignee_person_id, a.given_name || ' ' || a.family_name,
         t.created_by_person_id, c.given_name || ' ' || c.family_name,
         t.due_on, t.status, t.completed_at, t.created_at,
         t.status IN ('open', 'in_progress') AND t.due_on < current_date,
         work.may_manage_task(t.id)
    FROM work.task t
    LEFT JOIN work.project pr ON pr.id = t.project_id
    LEFT JOIN org.school s ON s.id = t.school_id
    JOIN people.person a ON a.id = t.assignee_person_id
    JOIN people.person c ON c.id = t.created_by_person_id
   WHERE work.may_read_task(t.id)
$$;
REVOKE ALL ON FUNCTION work.visible_tasks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.visible_tasks() TO pyth_api;

-- The people the signed-in person may give tasks to, per school (or the group):
-- themselves where they work, and everyone working where they hold tasks.assign.
CREATE FUNCTION work.assignable_people()
RETURNS TABLE (school_id uuid, person_id uuid, name text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  WITH places AS (
    SELECT s.id AS school_id FROM org.school s WHERE s.group_id = access.current_group_id() AND s.status = 'active'
    UNION ALL SELECT NULL::uuid
  )
  SELECT pl.school_id, p.id, p.given_name || ' ' || p.family_name
    FROM places pl
    CROSS JOIN people.person p
   WHERE app.current_person_id() IS NOT NULL AND p.group_id = access.current_group_id() AND p.status = 'active'
     AND (p.id = app.current_person_id() OR access.has_permission('tasks.assign', pl.school_id))
     AND work.works_in(p.id, pl.school_id)
   ORDER BY pl.school_id NULLS FIRST, p.family_name, p.given_name
$$;
REVOKE ALL ON FUNCTION work.assignable_people() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.assignable_people() TO pyth_api;

-- The projects the signed-in person may see, with the owner's name and how far along they are.
CREATE FUNCTION work.visible_projects()
RETURNS TABLE (id uuid, school_id uuid, school_name text, name text, description text, owner_person_id uuid,
               owner_name text, status text, created_at timestamptz, closed_at timestamptz, open_tasks bigint,
               overdue_tasks bigint, done_tasks bigint, may_manage boolean)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pr.id, pr.school_id, s.name, pr.name, pr.description, pr.owner_person_id, o.given_name || ' ' || o.family_name,
         pr.status, pr.created_at, pr.closed_at,
         count(t.id) FILTER (WHERE t.status IN ('open', 'in_progress')),
         count(t.id) FILTER (WHERE t.status IN ('open', 'in_progress') AND t.due_on < current_date),
         count(t.id) FILTER (WHERE t.status = 'done'),
         pr.owner_person_id = app.current_person_id() OR access.has_permission('tasks.assign', pr.school_id)
    FROM work.project pr
    JOIN people.person o ON o.id = pr.owner_person_id
    LEFT JOIN org.school s ON s.id = pr.school_id
    LEFT JOIN work.task t ON t.project_id = pr.id
   WHERE work.may_read_project(pr.id)
   GROUP BY pr.id, s.name, o.given_name, o.family_name
$$;
REVOKE ALL ON FUNCTION work.visible_projects() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION work.visible_projects() TO pyth_api;

ALTER TABLE work.project ENABLE ROW LEVEL SECURITY;
ALTER TABLE work.task ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON work.project, work.task TO pyth_api;
CREATE POLICY read ON work.task FOR SELECT TO pyth_api USING (work.may_read_task(id));
CREATE POLICY read ON work.project FOR SELECT TO pyth_api USING (work.may_read_project(id));

-- migrate:down
DROP TABLE work.task;
DROP TABLE work.project;
DROP FUNCTION work.visible_projects();
DROP FUNCTION work.assignable_people();
DROP FUNCTION work.visible_tasks();
DROP FUNCTION work.update_task(uuid, text, text, date, uuid);
DROP FUNCTION work.set_task_status(uuid, text);
DROP FUNCTION work.create_task(uuid, uuid, text, text, date, uuid);
DROP FUNCTION work.close_project(uuid);
DROP FUNCTION work.create_project(uuid, text, text);
DROP FUNCTION work.may_read_project(uuid);
DROP FUNCTION work.may_manage_task(uuid);
DROP FUNCTION work.may_read_task(uuid);
DROP FUNCTION work.may_assign(uuid, uuid, uuid);
DROP FUNCTION work.works_in(uuid, uuid);
DELETE FROM meta.state_transition WHERE machine IN ('task', 'project');
DELETE FROM access.role_permission WHERE permission_code IN ('tasks.read', 'tasks.assign');
DELETE FROM access.permission WHERE code IN ('tasks.read', 'tasks.assign');
DROP SCHEMA work;
