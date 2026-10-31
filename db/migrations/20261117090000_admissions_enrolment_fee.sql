-- migrate:up

-- Admissions M5.8: an optional enrolment fee per intake. The fee is a
-- published one-off offering of kind "fee" at the intake's school, so it has
-- its own price versions and billing company like any other service. A family
-- pays it through the common checkout once their child is enrolled from that
-- intake, at most once per child: the database refuses any fee line without
-- such an enrolment, or while another order for the same fee and child is paid
-- or still open for payment.

ALTER TABLE admissions.intake ADD COLUMN fee_offering_id uuid REFERENCES catalog.school_offering (id);
CREATE INDEX intake_fee_offering_idx ON admissions.intake (fee_offering_id);

-- Staff set or remove an intake's fee: a published fee offering of the same school.
CREATE FUNCTION admissions.set_intake_fee(p_intake_id uuid, p_offering_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  i record;
BEGIN
  SELECT * INTO i FROM admissions.intake WHERE id = p_intake_id FOR UPDATE;
  IF app.current_person_id() IS NULL OR NOT FOUND OR NOT access.has_permission('admissions.manage', i.school_id) THEN
    RAISE EXCEPTION 'no such intake' USING ERRCODE = 'P0002';
  END IF;
  IF p_offering_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM catalog.school_offering o JOIN catalog.service_definition d ON d.id = o.service_definition_id
        WHERE o.id = p_offering_id AND o.school_id = i.school_id AND o.status = 'published' AND d.kind = 'fee') THEN
    RAISE EXCEPTION 'the fee must be a published fee offering of the same school' USING ERRCODE = '23514';
  END IF;
  UPDATE admissions.intake SET fee_offering_id = p_offering_id WHERE id = i.id;
END $$;
REVOKE ALL ON FUNCTION admissions.set_intake_fee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.set_intake_fee(uuid, uuid) TO pyth_api;

-- A fee for this child and offering already paid, or in an order still open for payment.
CREATE FUNCTION admissions.fee_taken(p_student_id uuid, p_offering_id uuid, p_except_line uuid) RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM commerce.order_line l JOIN commerce.customer_order o ON o.id = l.order_id
     WHERE l.student_person_id = p_student_id AND l.offering_id = p_offering_id
       AND l.id IS DISTINCT FROM p_except_line
       AND (l.status = 'confirmed' OR (l.status = 'pending' AND o.status IN ('draft', 'pending_payment'))))
$$;
REVOKE ALL ON FUNCTION admissions.fee_taken(uuid, uuid, uuid) FROM PUBLIC;

-- The enrolment fees a guardian may pay for a child now: the child was
-- enrolled from an intake with a fee, and that fee is neither paid nor open.
CREATE FUNCTION admissions.fees_due(p_student_id uuid)
RETURNS TABLE (offering_id uuid, application_id uuid)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT it.fee_offering_id, a.id
    FROM admissions.application a JOIN admissions.intake it ON it.id = a.intake_id
   WHERE a.student_person_id = p_student_id AND a.status = 'enrolled' AND it.fee_offering_id IS NOT NULL
     AND access.is_guardian_of(p_student_id, 'pay')
     AND NOT admissions.fee_taken(p_student_id, it.fee_offering_id, NULL)
$$;
REVOKE ALL ON FUNCTION admissions.fees_due(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.fees_due(uuid) TO pyth_api;

-- The fees charged on the intakes a child was enrolled from, paid or not,
-- for a guardian who may pay: what the checkout may plan. Whether one may be
-- bought now is the order-line guard's to decide (PY026).
CREATE FUNCTION admissions.child_fees(p_student_id uuid) RETURNS TABLE (offering_id uuid)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT DISTINCT it.fee_offering_id
    FROM admissions.application a JOIN admissions.intake it ON it.id = a.intake_id
   WHERE a.student_person_id = p_student_id AND a.status = 'enrolled' AND it.fee_offering_id IS NOT NULL
     AND access.is_guardian_of(p_student_id, 'pay')
$$;
REVOKE ALL ON FUNCTION admissions.child_fees(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.child_fees(uuid) TO pyth_api;

-- The fee's state for each enrolled application of a child: due, open or paid.
CREATE FUNCTION admissions.fee_state(p_application_id uuid) RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM commerce.order_line l
                         WHERE l.student_person_id = a.student_person_id AND l.offering_id = it.fee_offering_id
                           AND l.status = 'confirmed') THEN 'paid'
           WHEN admissions.fee_taken(a.student_person_id, it.fee_offering_id, NULL) THEN 'open'
           ELSE 'due' END
    FROM admissions.application a JOIN admissions.intake it ON it.id = a.intake_id
   WHERE a.id = p_application_id AND a.status = 'enrolled' AND it.fee_offering_id IS NOT NULL
     AND (a.applicant_person_id = app.current_person_id() OR access.has_permission('admissions.manage', a.school_id))
$$;
REVOKE ALL ON FUNCTION admissions.fee_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admissions.fee_state(uuid) TO pyth_api;

-- Every order line for a fee offering: only for a child enrolled from an intake
-- that charges it, one at a time per child and fee, and one of it.
CREATE FUNCTION admissions.check_fee_line() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM catalog.school_offering o JOIN catalog.service_definition d ON d.id = o.service_definition_id
                  WHERE o.id = NEW.offering_id AND d.kind = 'fee') THEN
    RETURN NEW;
  END IF;
  -- Two baskets for the same fee wait for each other here.
  PERFORM pg_advisory_xact_lock(hashtext('admissions.fee'), hashtext(NEW.student_person_id::text || NEW.offering_id::text));
  IF NOT EXISTS (SELECT 1 FROM admissions.application a JOIN admissions.intake it ON it.id = a.intake_id
                  WHERE a.student_person_id = NEW.student_person_id AND a.status = 'enrolled'
                    AND it.fee_offering_id = NEW.offering_id) THEN
    RAISE EXCEPTION 'this fee is for children enrolled from an intake that charges it' USING ERRCODE = 'PY026';
  END IF;
  IF NEW.quantity <> 1 OR admissions.fee_taken(NEW.student_person_id, NEW.offering_id, NEW.id) THEN
    RAISE EXCEPTION 'the enrolment fee is already paid or being paid' USING ERRCODE = 'PY026';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION admissions.check_fee_line() FROM PUBLIC;
CREATE TRIGGER check_fee_line BEFORE INSERT ON commerce.order_line
  FOR EACH ROW EXECUTE FUNCTION admissions.check_fee_line();

-- migrate:down
DROP TRIGGER check_fee_line ON commerce.order_line;
DROP FUNCTION admissions.check_fee_line();
DROP FUNCTION admissions.fee_state(uuid);
DROP FUNCTION admissions.child_fees(uuid);
DROP FUNCTION admissions.fees_due(uuid);
DROP FUNCTION admissions.fee_taken(uuid, uuid, uuid);
DROP FUNCTION admissions.set_intake_fee(uuid, uuid);
DROP INDEX admissions.intake_fee_offering_idx;
ALTER TABLE admissions.intake DROP COLUMN fee_offering_id;
