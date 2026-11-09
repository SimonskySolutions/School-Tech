-- DEMO DATA - synthetic only. Never load into production.
--
-- Fills the three schools so the system can be shown: classes (some full), a
-- week's timetable, children and their families, attendance and grades, stock,
-- suppliers, expenses, budgets, tuition payments with invoices, and a full club
-- with a queue. Loaded on top of db/seeds/development.sql by
-- scripts/db-seed-demo.sh. Kept apart from that seed because the tests count the
-- development seed's rows. Safe to run again: it adds what is missing.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL app.actor = 'seed:demo';

-- The same id on every run, in the valid UUID form the API insists on.
CREATE FUNCTION pg_temp.demo_id(key text) RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-a' || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
    FROM md5(key) AS h
$$;

DO $demo$
DECLARE
  g        constant uuid := 'a1000000-0000-7000-8000-000000000001';
  company  constant uuid := 'e1000000-0000-7000-8000-000000000001';
  school_year constant text := '2026/2027';
  schools  constant uuid[] := ARRAY['b1000000-0000-7000-8000-00000000000a', 'b1000000-0000-7000-8000-00000000000b', 'b1000000-0000-7000-8000-00000000000c']::uuid[];
  letters  constant text[] := ARRAY['a', 'b', 'c'];
  principals constant uuid[] := ARRAY['c1000000-0000-7000-8000-000000000006', 'c1000000-0000-7000-8000-000000000007', 'c1000000-0000-7000-8000-000000000008']::uuid[];
  -- Each teacher teaches one subject, the last three in their own room.
  subjects constant text[] := ARRAY['Maths', 'Bulgarian', 'English', 'Science', 'History', 'PE', 'Music', 'Computing'];
  teacher_names constant text[][] := ARRAY[
    ARRAY['Ms Vasileva', 'Ms Stoyanova', 'Mr Harris', 'Ms Pavlova', 'Mr Yordanov', 'Mr Kolev', 'Ms Rangelova', 'Mr Bonev'],
    ARRAY['Mr Dimov', 'Ms Hristova', 'Ms Clarke', 'Mr Vladimirov', 'Ms Gencheva', 'Ms Tasheva', 'Mr Slavov', 'Ms Zaharieva'],
    ARRAY['Ms Mihaylova', 'Ms Lazarova', 'Mr Reed', 'Ms Boneva', 'Mr Tonev', 'Mr Valchev', 'Ms Kirova', 'Mr Radev']];
  girls    constant text[] := ARRAY['Maria', 'Elena', 'Viktoria', 'Nikol', 'Gergana', 'Raya', 'Sofia', 'Yoana', 'Kristina', 'Dara', 'Vanya', 'Teodora'];
  boys     constant text[] := ARRAY['Aleksandar', 'Martin', 'Daniel', 'Kaloyan', 'Stefan', 'Ivan', 'Nikola', 'Radoslav', 'Plamen', 'Bozhidar', 'Simeon', 'Asen'];
  roots    constant text[] := ARRAY['Ivan', 'Petr', 'Dimitr', 'Nikol', 'Stoyan', 'Hrist', 'Todor', 'Marin', 'Angel', 'Yordan', 'Atanas', 'Kirk', 'Bogdan', 'Stanim'];
  starts   constant time[] := ARRAY['08:00', '08:50', '09:40', '10:40', '11:30', '12:20']::time[];
  ends     constant time[] := ARRAY['08:40', '09:30', '10:20', '11:20', '12:10', '13:00']::time[];
  school_share constant numeric[] := ARRAY[1, 0.85, 0.6];

  i int; t int; pupil int; m int; weekday_no int; position_no int; seated int; h int; queued int := 0;
  school uuid; c record; it record; fee record; b record;
  teachers uuid[]; gym uuid; music uuid; lab uuid; home uuid; this_class uuid; room uuid; period uuid; inserted uuid;
  key text; student uuid; parent uuid; girl boolean; root text;
  this_order uuid; this_line uuid; this_payment uuid; paid timestamptz; spent date; amount bigint;
  art_offering constant uuid := 'd2000000-0000-7000-8000-0000000000b7';
  art_price    constant uuid := 'd3000000-0000-7000-8000-0000000000b7';
BEGIN
  -- Rooms, teachers and the bell schedule
  FOR i IN 1..3 LOOP
    school := schools[i];
    teachers := ARRAY[]::uuid[];
    FOR t IN 1..8 LOOP
      INSERT INTO scheduling.resource (id, group_id, school_id, kind, display_name)
      VALUES (pg_temp.demo_id('demo:teacher:' || school || t), g, school, 'teacher', teacher_names[i][t])
      ON CONFLICT DO NOTHING;
    END LOOP;
    INSERT INTO scheduling.resource (id, group_id, school_id, kind, display_name)
    SELECT pg_temp.demo_id('demo:room:' || school || name), g, school, 'room', name
      FROM unnest(ARRAY['Gym', 'Art and music room', 'Computer lab']) AS name
    ON CONFLICT DO NOTHING;
    FOR position_no IN 1..6 LOOP
      INSERT INTO scheduling.timetable_period (id, group_id, school_id, position, starts, ends)
      VALUES (pg_temp.demo_id('demo:period:' || school || position_no), g, school, position_no, starts[position_no], ends[position_no])
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;

  -- Classes with their children and families, and each class's week
  FOR c IN
    SELECT * FROM (VALUES
      (1, 0, '1A', '1', 24, 24), (1, 1, '2A', '2', 24, 21), (1, 2, '3A', '3', 24, 22), (1, 3, '4A', '4', 20, 18),
      (2, 0, '5A', '5', 26, 23), (2, 1, '6A', '6', 26, 26), (2, 2, '7A', '7', 26, 19),
      (3, 0, '1B', '1', 18, 18), (3, 1, '2B', '2', 18, 16), (3, 2, '3B', '3', 18, 12)
    ) AS v (school_no, class_no, label, grade, capacity, pupils)
  LOOP
    school := schools[c.school_no];
    SELECT array_agg(r.id ORDER BY ord) INTO teachers
      FROM unnest(teacher_names[c.school_no:c.school_no]) WITH ORDINALITY AS u (name, ord)
      JOIN scheduling.resource r ON r.school_id = school AND r.kind = 'teacher' AND r.display_name = u.name;

    INSERT INTO scheduling.resource (id, group_id, school_id, kind, display_name)
    VALUES (pg_temp.demo_id('demo:room:' || school || c.label), g, school, 'room', 'Room ' || c.label)
    ON CONFLICT DO NOTHING;
    SELECT id INTO home FROM scheduling.resource WHERE school_id = school AND kind = 'room' AND display_name = 'Room ' || c.label;
    SELECT id INTO gym FROM scheduling.resource WHERE school_id = school AND kind = 'room' AND display_name = 'Gym';
    SELECT id INTO music FROM scheduling.resource WHERE school_id = school AND kind = 'room' AND display_name = 'Art and music room';
    SELECT id INTO lab FROM scheduling.resource WHERE school_id = school AND kind = 'room' AND display_name = 'Computer lab';

    INSERT INTO scheduling.school_class (id, group_id, school_id, academic_year, grade_level, label, capacity, form_teacher_id, home_room_id)
    VALUES (pg_temp.demo_id('demo:class:' || school || c.label), g, school, school_year, c.grade, c.label, c.capacity,
            teachers[1 + c.class_no], home)
    ON CONFLICT DO NOTHING;
    SELECT id INTO this_class FROM scheduling.school_class
     WHERE school_id = school AND academic_year = school_year AND label = c.label;

    -- The development seed's own children join the class of their label.
    UPDATE people.enrolment e SET class_id = demo_class.id
      FROM scheduling.school_class demo_class
     WHERE demo_class.id = this_class AND e.school_id = school AND e.academic_year = school_year
       AND e.class_label = c.label AND e.class_id IS NULL;

    -- A different teacher in every class in each period, so nobody is in two places.
    FOR weekday_no IN 1..5 LOOP
      FOR position_no IN 1..6 LOOP
        t := (c.class_no + weekday_no + position_no) % 8;
        room := CASE t WHEN 5 THEN gym WHEN 6 THEN music WHEN 7 THEN lab ELSE home END;
        SELECT id INTO period FROM scheduling.timetable_period WHERE school_id = school AND position = position_no;
        INSERT INTO scheduling.timetable_entry (group_id, school_id, academic_year, class_id, weekday, period_id, subject, teacher_id, room_id)
        VALUES (g, school, school_year, this_class, weekday_no, period, subjects[t + 1], teachers[t + 1], room)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END LOOP;

    SELECT count(*) INTO seated FROM people.enrolment e WHERE e.class_id = this_class AND e.status IN ('active', 'suspended');
    FOR pupil IN (seated + 1)..c.pupils LOOP
      key := letters[c.school_no] || ':' || c.label || ':' || pupil;
      h := hashtext(key) & 2147483647;
      girl := pupil % 2 = 0;
      root := roots[1 + h % array_length(roots, 1)];
      student := pg_temp.demo_id('demo:student:' || key);
      parent := pg_temp.demo_id('demo:parent:' || key);
      INSERT INTO people.person (id, group_id, given_name, family_name, date_of_birth, registered_school_id)
      VALUES (student, g,
              CASE WHEN girl THEN girls[1 + (h / 16) % 12] ELSE boys[1 + (h / 16) % 12] END,
              root || CASE WHEN girl THEN 'ova' ELSE 'ov' END,
              make_date(2020 - c.grade::int, 1 + pupil % 12, 1 + h % 27), school)
      ON CONFLICT (id) DO NOTHING;
      INSERT INTO people.person (id, group_id, given_name, family_name, email)
      VALUES (parent, g,
              CASE WHEN pupil % 3 = 0 THEN boys[1 + (h / 256) % 12] ELSE girls[1 + (h / 256) % 12] END,
              root || CASE WHEN pupil % 3 = 0 THEN 'ov' ELSE 'ova' END,
              format('parent.%s.%s.%s@pythagoras.test', letters[c.school_no], lower(c.label), pupil))
      ON CONFLICT (id) DO NOTHING;
      IF NOT EXISTS (SELECT 1 FROM people.guardian_relationship r WHERE r.guardian_person_id = parent AND r.student_person_id = student) THEN
        INSERT INTO people.guardian_relationship (group_id, guardian_person_id, student_person_id, relationship, can_consent, status, verified_by_person_id, verified_at)
        VALUES (g, parent, student, 'parent', true, 'active', principals[c.school_no], now());
      END IF;
      INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, class_id, status, start_date)
      VALUES (g, student, school, school_year, this_class, 'active', DATE '2026-09-15');
    END LOOP;
  END LOOP;

  -- Three weeks of the register. Today's is left for a teacher to take.
  INSERT INTO academic.attendance (group_id, school_id, class_id, student_person_id, day, status)
  SELECT g, e.school_id, e.class_id, e.student_person_id, d::date,
         CASE (hashtext(e.student_person_id::text || d::date::text) & 2147483647) % 40
           WHEN 0 THEN 'absent' WHEN 1 THEN 'absent' WHEN 2 THEN 'late' WHEN 3 THEN 'excused' ELSE 'present' END
    FROM people.enrolment e
   CROSS JOIN generate_series(current_date - 21, current_date - 1, interval '1 day') AS d
   WHERE e.group_id = g AND e.status = 'active' AND e.class_id IS NOT NULL AND extract(isodow FROM d) < 6
  ON CONFLICT (class_id, student_person_id, day) DO NOTHING;

  -- Three grades in each of five subjects this term.
  INSERT INTO academic.grade (id, group_id, school_id, class_id, student_person_id, subject, term, value, given_on)
  SELECT pg_temp.demo_id('demo:grade:' || e.student_person_id || s.subject || n), g, e.school_id, e.class_id, e.student_person_id,
         s.subject, 1,
         (ARRAY[3, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 2])[1 + (hashtext(e.student_person_id::text || s.subject || n) & 2147483647) % 12],
         current_date - (n * 11 + s.ord::int)
    FROM people.enrolment e
   CROSS JOIN unnest(subjects[1:5]) WITH ORDINALITY AS s (subject, ord)
   CROSS JOIN generate_series(1, 3) AS n
   WHERE e.group_id = g AND e.status = 'active' AND e.class_id IS NOT NULL
  ON CONFLICT (id) DO NOTHING;

  -- Suppliers, shared by the group, and what each school keeps.
  INSERT INTO inventory.supplier (id, group_id, name, email, phone)
  SELECT pg_temp.demo_id('demo:supplier:' || name), g, name, email, phone FROM (VALUES
    ('Northside School Books', 'orders@northside-books.test', '+359 2 555 0101'),
    ('Danube Office Supply', 'sales@danube-office.test', '+359 2 555 0102'),
    ('Classroom Tech Partners', 'hello@classroom-tech.test', '+359 52 555 0103'),
    ('Fresh Table Catering Supply', 'kitchen@fresh-table.test', '+359 52 555 0104'),
    ('Sports and Play Depot', NULL, '+359 2 555 0105')
  ) AS v (name, email, phone)
  ON CONFLICT DO NOTHING;

  FOR it IN
    SELECT * FROM (VALUES
      ('book', 'Maths textbooks', 30, 'Northside School Books', 84, 46, 22),
      ('book', 'Bulgarian readers', 30, 'Northside School Books', 28, 71, 38),
      ('book', 'English workbooks', 25, 'Northside School Books', 66, 19, 41),
      ('book', 'Atlases', 10, 'Northside School Books', 24, 18, 6),
      ('equipment', 'Laptops', 8, 'Classroom Tech Partners', 26, 31, 12),
      ('equipment', 'Projectors', 2, 'Classroom Tech Partners', 8, 7, 2),
      ('equipment', 'Microscopes', 4, 'Classroom Tech Partners', 12, 3, 5),
      ('equipment', 'Footballs and bibs', 6, 'Sports and Play Depot', 18, 14, 5),
      ('supply', 'Printer paper, reams', 40, 'Danube Office Supply', 120, 35, 64),
      ('supply', 'Whiteboard markers', 30, 'Danube Office Supply', 22, 90, 48),
      ('supply', 'Art paint sets', 12, 'Danube Office Supply', 40, 16, 9),
      ('supply', 'Kitchen cleaning supplies', 10, 'Fresh Table Catering Supply', 34, 25, 12)
    ) AS v (kind, name, reorder, supplier, a, b, c)
  LOOP
    FOR i IN 1..3 LOOP
      inserted := NULL;
      INSERT INTO inventory.item (id, group_id, school_id, kind, name, reorder_level, supplier_id)
      VALUES (pg_temp.demo_id('demo:item:' || schools[i] || it.name), g, schools[i], it.kind, it.name, it.reorder,
              (SELECT id FROM inventory.supplier WHERE group_id = g AND name = it.supplier))
      ON CONFLICT DO NOTHING
      RETURNING id INTO inserted;
      IF inserted IS NOT NULL THEN
        INSERT INTO inventory.movement (group_id, school_id, item_id, reason, change)
        VALUES (g, schools[i], inserted, 'delivered', (ARRAY[it.a, it.b, it.c])[i]);
      END IF;
    END LOOP;
  END LOOP;

  -- Budgets for the year, and the spending so far.
  FOR it IN
    SELECT * FROM (VALUES
      ('materials', 'Teaching materials', 30000, 'Northside School Books'),
      ('food', 'Kitchen deliveries', 120000, 'Fresh Table Catering Supply'),
      ('utilities', 'Power, water and heating', 60000, NULL),
      ('maintenance', 'Building repairs', 40000, NULL),
      ('transport', 'School bus running costs', 35000, NULL),
      ('events', 'School events', 15000, NULL),
      ('marketing', 'Open days and advertising', 20000, NULL),
      ('other', 'Office costs', 10000, 'Danube Office Supply')
    ) AS v (category, what, euros, supplier)
  LOOP
    FOR i IN 1..3 LOOP
      INSERT INTO finance.budget (group_id, school_id, academic_year, category, amount_minor)
      VALUES (g, schools[i], school_year, it.category, round(it.euros * 100 * school_share[i])::bigint)
      ON CONFLICT DO NOTHING;
      FOR m IN 9..11 LOOP
        h := hashtext(schools[i]::text || it.category || m) & 2147483647;
        spent := LEAST(make_date(2026, m, 2 + h % 20), current_date - 1);
        amount := round(it.euros * 100 * school_share[i] * (7 + h % 6) / 100)::bigint;
        INSERT INTO finance.expense (id, group_id, school_id, category, description, supplier_id, amount_minor, spent_on)
        VALUES (pg_temp.demo_id('demo:expense:' || schools[i] || it.category || m), g, schools[i], it.category,
                it.what || ', ' || to_char(make_date(2026, m, 1), 'FMMonth'),
                (SELECT id FROM inventory.supplier WHERE group_id = g AND name = it.supplier), amount, spent)
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
  -- One budget nearly used up, and one gone over.
  INSERT INTO finance.expense (id, group_id, school_id, category, description, amount_minor, spent_on) VALUES
    (pg_temp.demo_id('demo:expense:open-day-b'), g, schools[2], 'events', 'Autumn open day', 790000, DATE '2026-10-17'),
    (pg_temp.demo_id('demo:expense:adverts-c'), g, schools[3], 'marketing', 'Regional newspaper adverts', 960000, DATE '2026-10-08')
  ON CONFLICT (id) DO NOTHING;

  -- Tuition, paid month by month. One family in seven still owes November.
  FOR fee IN
    SELECT DISTINCT ON (en.student_person_id) en.student_person_id, en.school_id, r.guardian_person_id, o.id AS offering,
           p.id AS price, p.unit_amount_minor
      FROM people.enrolment en
      JOIN people.guardian_relationship r ON r.student_person_id = en.student_person_id AND r.status = 'active'
      JOIN catalog.school_offering o ON o.school_id = en.school_id AND o.code = 'tuition'
      JOIN catalog.price_version p ON p.offering_id = o.id
     WHERE en.group_id = g AND en.status = 'active'
     ORDER BY en.student_person_id, r.guardian_person_id
  LOOP
    FOR m IN 9..11 LOOP
      key := 'demo-tuition-' || fee.student_person_id || '-' || m;
      h := hashtext(key) & 2147483647;
      paid := make_timestamptz(2026, m, 1 + h % 4, 10, h % 60, 0, 'Europe/Sofia');
      CONTINUE WHEN paid > now()
                 OR (m = 11 AND (hashtext(fee.student_person_id::text) & 2147483647) % 7 = 0)
                 OR EXISTS (SELECT 1 FROM commerce.customer_order x WHERE x.payer_person_id = fee.guardian_person_id AND x.idempotency_key = key);
      this_order := pg_temp.demo_id('demo:order:' || key);
      this_line := pg_temp.demo_id('demo:line:' || key);
      this_payment := pg_temp.demo_id('demo:payment:' || key);
      INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id, created_at)
      VALUES (this_order, g, company, fee.guardian_person_id, 'family_portal', key, fee.guardian_person_id, paid);
      INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                       price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
      VALUES (this_line, g, this_order, company, 1, fee.school_id, fee.offering, fee.student_person_id, fee.price,
              'Tuition, ' || to_char(make_date(2026, m, 1), 'FMMonth YYYY'), 1, 'EUR', fee.unit_amount_minor, 0, fee.unit_amount_minor);
      UPDATE commerce.customer_order SET status = 'pending_payment', placed_at = paid, total_minor = fee.unit_amount_minor,
             expires_at = paid + interval '30 minutes' WHERE id = this_order;
      INSERT INTO commerce.payment (id, group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency)
      VALUES (this_payment, g, this_order, company, 'development', 'test', fee.unit_amount_minor, 'EUR');
      UPDATE commerce.payment SET status = 'pending', provider_checkout_id = 'demo_' || this_order WHERE id = this_payment;
      UPDATE commerce.payment SET status = 'succeeded', succeeded_at = paid, provider_payment_id = 'demo_' || this_order,
             provider_status = 'paid', provider_status_at = paid WHERE id = this_payment;
      UPDATE commerce.customer_order SET status = 'paid', paid_at = paid WHERE id = this_order;
      UPDATE commerce.order_line SET status = 'confirmed' WHERE id = this_line;
      INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, payment_id, currency, amount_minor, allocated_at)
      VALUES (g, this_line, company, fee.school_id, 'payment', this_payment, 'EUR', fee.unit_amount_minor, paid);
    END LOOP;
  END LOOP;

  -- A popular club: full for every meeting, with three children queueing.
  INSERT INTO catalog.service_definition (id, group_id, code, kind, name)
  VALUES ('d1000000-0000-7000-8000-0000000000d1', g, 'art', 'activity', 'Art studio')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status, eligibility)
  VALUES (art_offering, g, schools[2], 'd1000000-0000-7000-8000-0000000000d1', company, 'art', 'Art studio, Pythagoras Varna', 'published',
          '{"grades": ["5", "6", "7"]}')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO catalog.price_version (id, group_id, offering_id, version, unit_amount_minor, vat_rate_bp, price_unit, valid_from)
  VALUES (art_price, g, art_offering, 1, 6000, 0, 'per_term', TIMESTAMPTZ '2026-09-01 00:00 Europe/Sofia')
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM catalog.policy_version p WHERE p.offering_id = art_offering) THEN
    INSERT INTO catalog.policy_version (group_id, offering_id, kind, version, rules, valid_from)
    VALUES (g, art_offering, 'booking_and_cancellation', 1,
            '{"booking_cutoff": "session start minus 24 hours", "cancellation_cutoff": "before first session", "after_cancellation": "account_credit"}',
            TIMESTAMPTZ '2026-09-01 00:00 Europe/Sofia');
  END IF;
  INSERT INTO scheduling.session (group_id, school_id, offering_id, starts_at, ends_at, location_label, capacity, booking_cutoff_at)
  SELECT g, s.id, art_offering,
         (d::date + TIME '15:00') AT TIME ZONE s.time_zone, (d::date + TIME '16:00') AT TIME ZONE s.time_zone,
         'Art and music room', 12, (d::date + TIME '15:00') AT TIME ZONE s.time_zone - interval '24 hours'
    FROM org.school s
   CROSS JOIN generate_series(current_date + 2, current_date + 56, interval '1 day') AS d
   WHERE s.id = schools[2] AND extract(isodow FROM d) = 3
     AND NOT EXISTS (SELECT 1 FROM scheduling.session x WHERE x.offering_id = art_offering
                      AND x.starts_at = (d::date + TIME '15:00') AT TIME ZONE s.time_zone);

  FOR b IN
    SELECT en.student_person_id, r.guardian_person_id
      FROM people.enrolment en
      JOIN scheduling.school_class k ON k.id = en.class_id
      JOIN people.guardian_relationship r ON r.student_person_id = en.student_person_id AND r.status = 'active'
     WHERE k.school_id = schools[2] AND k.label = '6A'
     ORDER BY en.student_person_id LIMIT 12
  LOOP
    INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, confirmed_at, created_by_person_id)
    SELECT g, schools[2], x.id, b.student_person_id, 'confirmed', now(), b.guardian_person_id
      FROM scheduling.session x
     WHERE x.offering_id = art_offering AND x.status = 'scheduled' AND x.confirmed_count + x.reserved_count < x.capacity
    ON CONFLICT DO NOTHING;
  END LOOP;
  FOR b IN
    SELECT en.student_person_id, r.guardian_person_id
      FROM people.enrolment en
      JOIN scheduling.school_class k ON k.id = en.class_id
      JOIN people.guardian_relationship r ON r.student_person_id = en.student_person_id AND r.status = 'active'
     WHERE k.school_id = schools[2] AND k.label = '7A'
     ORDER BY en.student_person_id LIMIT 3
  LOOP
    queued := queued + 1;
    INSERT INTO scheduling.waiting_entry (id, group_id, school_id, offering_id, student_person_id, added_by, created_at)
    VALUES (pg_temp.demo_id('demo:waiting:' || queued), g, schools[2], art_offering, b.student_person_id, b.guardian_person_id, now() - (4 - queued) * interval '2 days')
    ON CONFLICT DO NOTHING;
  END LOOP;
END
$demo$;

-- The names the group uses, and an address for each school's website. The
-- development seed keeps School A, B and C for the tests and puts them back
-- when it runs again. Website text is English for now, so the sites say so.
UPDATE org.school s SET name = n.name
  FROM (VALUES ('b1000000-0000-7000-8000-00000000000a'::uuid, 'Pythagoras Sofia'),
               ('b1000000-0000-7000-8000-00000000000b'::uuid, 'Pythagoras Varna'),
               ('b1000000-0000-7000-8000-00000000000c'::uuid, 'Pythagoras Academy')) AS n (id, name)
 WHERE s.id = n.id AND s.name IS DISTINCT FROM n.name;

UPDATE org.website w SET name = n.name, default_locale = 'en'
  FROM (VALUES ('c2000000-0000-7000-8000-000000000001'::uuid, 'Pythagoras'),
               ('c2000000-0000-7000-8000-00000000000a'::uuid, 'Pythagoras Sofia'),
               ('c2000000-0000-7000-8000-00000000000b'::uuid, 'Pythagoras Varna'),
               ('c2000000-0000-7000-8000-00000000000c'::uuid, 'Pythagoras Academy')) AS n (id, name)
 WHERE w.id = n.id AND (w.name IS DISTINCT FROM n.name OR w.default_locale <> 'en');

UPDATE catalog.school_offering
   SET name = replace(replace(replace(name, 'School A', 'Pythagoras Sofia'), 'School B', 'Pythagoras Varna'), 'School C', 'Pythagoras Academy')
 WHERE name ~ 'School [ABC]';

-- sofia., varna. and academy.pythagoras.localhost become each site's main
-- address; the school-a/b/c ones keep working.
UPDATE org.website_domain SET is_primary = false
 WHERE hostname IN ('school-a.pythagoras.localhost', 'school-b.pythagoras.localhost', 'school-c.pythagoras.localhost')
   AND is_primary;
INSERT INTO org.website_domain (website_id, group_id, hostname, is_primary, verification_method, status, verified_at) VALUES
  ('c2000000-0000-7000-8000-00000000000a', 'a1000000-0000-7000-8000-000000000001', 'sofia.pythagoras.localhost',   true, 'local_development', 'verified', now()),
  ('c2000000-0000-7000-8000-00000000000b', 'a1000000-0000-7000-8000-000000000001', 'varna.pythagoras.localhost',   true, 'local_development', 'verified', now()),
  ('c2000000-0000-7000-8000-00000000000c', 'a1000000-0000-7000-8000-000000000001', 'academy.pythagoras.localhost', true, 'local_development', 'verified', now())
ON CONFLICT (hostname) DO UPDATE SET is_primary = true WHERE NOT org.website_domain.is_primary;

COMMIT;

SELECT s.name || ': ' || count(DISTINCT c.id) || ' classes, ' || count(e.id) || ' children, '
       || count(DISTINCT c.id) FILTER (WHERE c.capacity <= (SELECT count(*) FROM people.enrolment x WHERE x.class_id = c.id)) || ' full'
  FROM org.school s
  JOIN scheduling.school_class c ON c.school_id = s.id
  LEFT JOIN people.enrolment e ON e.class_id = c.id
 GROUP BY s.name ORDER BY s.name;
SELECT count(*) || ' invoices, ' || coalesce(sum(total_minor) / 100, 0) || ' EUR paid' FROM finance.invoice;
