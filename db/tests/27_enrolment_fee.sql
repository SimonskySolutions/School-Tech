-- The enrolment fee (M5.8).
BEGIN;
\ir _fixtures.sql
\echo '# 27 admissions enrolment fee'

\set FEED '''d1000000-0000-7000-8000-0000000000fe'''
\set FEEA '''d2000000-0000-7000-8000-0000000000fe'''
\set PFEE '''70000000-0000-7000-8000-0000000000fe'''
INSERT INTO catalog.service_definition (id, group_id, code, kind, name) VALUES (:FEED, :G, 'enrolment-fee', 'fee', 'Enrolment fee');
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status)
VALUES (:FEEA, :G, :A, :FEED, :E1, 'enrolment-fee', 'Enrolment fee, School A', 'published');
INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from)
VALUES (:PFEE, :G, :FEEA, 1, 15000, 0, 'one_off', now() - interval '1 day');

SELECT test.as_person(:DPO);
SELECT admissions.publish_privacy_notice(repeat('Synthetic admissions notice. ', 3), 'News about open days (synthetic)');
RESET ROLE; SELECT test.as_person(:PRA);
CREATE TEMP TABLE intake ON COMMIT DROP AS SELECT admissions.open_intake(:A, '2027/28', '1', 5, current_date - 1, current_date + 30) AS id;
GRANT SELECT ON intake TO pyth_api;

-- Setting the fee: a published fee offering of the intake's school, by its admissions staff.
SELECT test.expect_error(format('SELECT admissions.set_intake_fee((SELECT id FROM intake), %L)', :LA), '23514',
  'lunch is not a fee');
RESET ROLE; SELECT test.as_person(:TEAB);
SELECT test.expect_error(format('SELECT admissions.set_intake_fee((SELECT id FROM intake), %L)', :FEEA), 'P0002',
  'staff at another school set no fee');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.set_intake_fee((SELECT id FROM intake), :FEEA);
RESET ROLE;

-- Q's new child is enrolled from the intake.
SELECT test.as_person(:Q);
CREATE TEMP TABLE app ON COMMIT DROP AS
SELECT admissions.submit_application((SELECT id FROM intake), (SELECT id FROM admissions.privacy_notice WHERE group_id = :G), NULL, 'Fea', 'Georgieva', DATE '2021-01-01', NULL, NULL) AS id;
GRANT SELECT ON app TO pyth_api;
SELECT test.ok((SELECT count(*) FROM admissions.fees_due(:K3)) = 0, 'no fee before an enrolment from the intake');
RESET ROLE; SELECT test.as_person(:PRA);
SELECT admissions.make_offer((SELECT id FROM app), current_date + 7);
RESET ROLE; SELECT test.as_person(:Q);
SELECT admissions.answer_offer((SELECT id FROM app), true);
RESET ROLE; SELECT test.as_person(:PRA);
CREATE TEMP TABLE child ON COMMIT DROP AS
SELECT admissions.enrol_application((SELECT id FROM app), current_date, NULL, 'mother') AS id;
GRANT SELECT ON child TO pyth_api;
RESET ROLE;

-- Who owes it.
SELECT test.as_person(:Q);
SELECT test.ok((SELECT offering_id FROM admissions.fees_due((SELECT id FROM child))) = :FEEA, 'the parent owes the fee for the enrolled child');
SELECT test.ok(admissions.fee_state((SELECT id FROM app)) = 'due', 'and sees it as due');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM admissions.fees_due((SELECT id FROM child))) = 0, 'another parent owes nothing for her');
SELECT test.ok(admissions.fee_state((SELECT id FROM app)) IS NULL, 'and sees nothing of it');
RESET ROLE;

-- The guard on order lines.
\set FO1 '''92000000-0000-7000-8000-0000000000f1'''
\set FO2 '''92000000-0000-7000-8000-0000000000f2'''
\set FO3 '''92000000-0000-7000-8000-0000000000f3'''
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id) VALUES
  (:FO1, :G, :E1, :Q, 'family_portal', 'test-fee-1', :Q),
  (:FO2, :G, :E1, :Q, 'family_portal', 'test-fee-2', :Q),
  (:FO3, :G, :E1, :Q, 'family_portal', 'test-fee-3', :Q);
CREATE FUNCTION pg_temp.fee_line(p_order uuid, p_student uuid, p_quantity integer) RETURNS void LANGUAGE sql AS $$
  INSERT INTO commerce.order_line (group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                   price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
  VALUES ('a0000000-0000-7000-8000-000000000001', p_order, 'e0000000-0000-7000-8000-000000000001',
          (SELECT coalesce(max(line_no), 0) + 1 FROM commerce.order_line WHERE order_id = p_order),
          '5c000000-0000-7000-8000-00000000000a', 'd2000000-0000-7000-8000-0000000000fe', p_student,
          '70000000-0000-7000-8000-0000000000fe', 'Enrolment fee, School A', p_quantity, 'EUR', 15000, 0, 15000 * p_quantity)
$$;
SELECT test.expect_error(format('SELECT pg_temp.fee_line(%L, %L, 1)', :FO1, :K1), 'PY026',
  'no fee for a child not enrolled from an intake that charges it');
SELECT test.expect_error(format('SELECT pg_temp.fee_line(%L, (SELECT id FROM child), 2)', :FO1), 'PY026',
  'the fee is bought once');
SELECT pg_temp.fee_line(:FO1, (SELECT id FROM child), 1);
SELECT test.expect_error(format('SELECT pg_temp.fee_line(%L, (SELECT id FROM child), 1)', :FO2), 'PY026',
  'not again while the first order is open');
SELECT test.as_person(:Q);
SELECT test.ok(admissions.fee_state((SELECT id FROM app)) = 'open' AND (SELECT count(*) FROM admissions.fees_due((SELECT id FROM child))) = 0,
  'an open order shows the fee as being paid');
RESET ROLE;
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 15000 WHERE id = :FO1;
UPDATE commerce.customer_order SET status = 'expired' WHERE id = :FO1;
SELECT pg_temp.fee_line(:FO2, (SELECT id FROM child), 1);
SELECT test.ok((SELECT count(*) FROM commerce.order_line WHERE order_id = :FO2) = 1, 'after the first order expired the fee can be bought again');
UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = now(), total_minor = 15000 WHERE id = :FO2;
INSERT INTO commerce.payment (group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency, status, succeeded_at)
VALUES (:G, :FO2, :E1, 'stripe', 'test', 15000, 'EUR', 'succeeded', now());
UPDATE commerce.customer_order SET status = 'paid', paid_at = now() WHERE id = :FO2;
UPDATE commerce.order_line SET status = 'confirmed' WHERE order_id = :FO2;
SELECT test.as_person(:Q);
SELECT test.ok(admissions.fee_state((SELECT id FROM app)) = 'paid', 'a paid fee shows as paid');
SELECT test.ok((SELECT count(*) FROM admissions.fees_due((SELECT id FROM child))) = 0, 'and is no longer due');
RESET ROLE;
SELECT test.expect_error(format('SELECT pg_temp.fee_line(%L, (SELECT id FROM child), 1)', :FO3), 'PY026',
  'a paid fee is never bought twice');
SELECT test.as_person(:Q);
SELECT test.ok((SELECT offering_id FROM admissions.child_fees((SELECT id FROM child))) = :FEEA,
  'the checkout still finds the fee charged for the child, and leaves the refusal to the guard');
RESET ROLE; SELECT test.as_person(:P);
SELECT test.ok((SELECT count(*) FROM admissions.child_fees((SELECT id FROM child))) = 0, 'but not for another family');
RESET ROLE;

ROLLBACK;
