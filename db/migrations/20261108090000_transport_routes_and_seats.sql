-- migrate:up

-- Transport (M4.5, ADR 0024). A route for one term is an offering of kind
-- "transport"; the term is its one session, whose capacity is the seats, so a
-- seat is an ordinary booking with the usual capacity guarantee. The route has
-- a vehicle, weekdays and ordered stops; each seat names its stop.

CREATE TABLE scheduling.transport_route (
  offering_id  uuid PRIMARY KEY,
  group_id     uuid NOT NULL REFERENCES org.education_group (id),
  school_id    uuid NOT NULL,
  vehicle      text CHECK (length(vehicle) BETWEEN 1 AND 120),
  weekdays     smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'
               CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (offering_id, school_id) REFERENCES catalog.school_offering (id, school_id)
);
CREATE INDEX transport_route_school_idx ON scheduling.transport_route (school_id);

CREATE TABLE scheduling.transport_stop (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  group_id      uuid NOT NULL REFERENCES org.education_group (id),
  school_id     uuid NOT NULL,
  offering_id   uuid NOT NULL REFERENCES scheduling.transport_route (offering_id),
  position      smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  pickup_time   time NOT NULL,
  dropoff_time  time,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offering_id, position),
  UNIQUE (id, offering_id)
);
CREATE INDEX transport_stop_school_idx ON scheduling.transport_stop (school_id);

-- A route is for transport offerings only.
CREATE FUNCTION scheduling.check_transport_route() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM catalog.school_offering o
                   JOIN catalog.service_definition d ON d.id = o.service_definition_id
                  WHERE o.id = NEW.offering_id AND o.group_id = NEW.group_id AND d.kind = 'transport') THEN
    RAISE EXCEPTION 'routes are for transport offerings' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scheduling.check_transport_route() FROM PUBLIC;
CREATE TRIGGER check_route BEFORE INSERT OR UPDATE OF offering_id ON scheduling.transport_route
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_transport_route();

-- The child's stop, on the seat itself.
ALTER TABLE scheduling.booking ADD COLUMN transport_stop_id uuid REFERENCES scheduling.transport_stop (id);
CREATE INDEX booking_transport_stop_idx ON scheduling.booking (transport_stop_id);
GRANT INSERT (transport_stop_id) ON scheduling.booking TO pyth_api;

-- A transport seat needs an active stop of its own route; other bookings have none.
CREATE FUNCTION scheduling.check_transport_stop() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  offering uuid;
  kind text;
BEGIN
  SELECT x.offering_id, d.kind INTO offering, kind
    FROM scheduling.session x
    JOIN catalog.school_offering o ON o.id = x.offering_id
    JOIN catalog.service_definition d ON d.id = o.service_definition_id
   WHERE x.id = NEW.session_id;
  IF kind IS DISTINCT FROM 'transport' THEN
    IF NEW.transport_stop_id IS NOT NULL THEN
      RAISE EXCEPTION 'only transport seats have a stop' USING ERRCODE = 'PY018';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.transport_stop_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM scheduling.transport_stop st
        WHERE st.id = NEW.transport_stop_id AND st.offering_id = offering AND st.status = 'active') THEN
    RAISE EXCEPTION 'a seat needs one of the route''s stops' USING ERRCODE = 'PY018';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION scheduling.check_transport_stop() FROM PUBLIC;
CREATE TRIGGER check_transport_stop BEFORE INSERT OR UPDATE OF transport_stop_id ON scheduling.booking
  FOR EACH ROW EXECUTE FUNCTION scheduling.check_transport_stop();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduling.transport_route FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON scheduling.transport_stop  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.transport_route FOR EACH ROW EXECUTE FUNCTION audit.log_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE OR DELETE ON scheduling.transport_stop  FOR EACH ROW EXECUTE FUNCTION audit.log_change();

ALTER TABLE scheduling.transport_route ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling.transport_stop ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT (offering_id, group_id, school_id, vehicle, weekdays), UPDATE (vehicle, weekdays)
  ON scheduling.transport_route TO pyth_api;
GRANT SELECT, INSERT (id, group_id, school_id, offering_id, position, name, pickup_time, dropoff_time),
      UPDATE (name, pickup_time, dropoff_time, status)
  ON scheduling.transport_stop TO pyth_api;
GRANT SELECT ON scheduling.transport_route, scheduling.transport_stop TO pyth_worker;

-- Routes and stops are visible in the group (families choose a stop); changing them needs catalog.manage.
CREATE POLICY read ON scheduling.transport_route FOR SELECT TO pyth_api USING (group_id = access.current_group_id());
CREATE POLICY manage_insert ON scheduling.transport_route FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY manage_update ON scheduling.transport_route FOR UPDATE TO pyth_api
  USING (access.has_permission('catalog.manage', school_id)) WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY read ON scheduling.transport_stop FOR SELECT TO pyth_api USING (group_id = access.current_group_id());
CREATE POLICY manage_insert ON scheduling.transport_stop FOR INSERT TO pyth_api
  WITH CHECK (access.has_permission('catalog.manage', school_id));
CREATE POLICY manage_update ON scheduling.transport_stop FOR UPDATE TO pyth_api
  USING (access.has_permission('catalog.manage', school_id)) WITH CHECK (access.has_permission('catalog.manage', school_id));

-- migrate:down
DROP TRIGGER check_transport_stop ON scheduling.booking;
DROP FUNCTION scheduling.check_transport_stop();
REVOKE INSERT (transport_stop_id) ON scheduling.booking FROM pyth_api;
DROP INDEX scheduling.booking_transport_stop_idx;
ALTER TABLE scheduling.booking DROP COLUMN transport_stop_id;
DROP TABLE scheduling.transport_stop;
DROP TABLE scheduling.transport_route;
DROP FUNCTION scheduling.check_transport_route();
