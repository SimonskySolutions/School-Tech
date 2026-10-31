#!/usr/bin/env bash
# Two real sessions race for the last seat of a session (capacity 1). The first
# holds its transaction open; the second must wait on the row lock and then be
# refused with PY002. Exactly one booking may exist afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

DB=${1:?database name}
SESSION=80000000-0000-7000-8000-0000000000ca   # chess, School A, capacity 1 (see _fixtures.sql)
psql_su() { docker compose exec -T -u postgres postgres psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

# Commit the fixtures so that both sessions can see them.
psql_su >/dev/null 2>&1 <<'SQL'
BEGIN;
\i /opt/pythagoras/db/tests/_fixtures.sql
COMMIT;
SQL

first=$(mktemp); second=$(mktemp)
psql_su >"$first" 2>&1 <<SQL &
BEGIN;
SELECT test.as_person('20000000-0000-7000-8000-000000000001');
INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id)
VALUES ('a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a', '$SESSION',
        '30000000-0000-7000-8000-000000000001', 'reserved', now() + interval '15 minutes', '20000000-0000-7000-8000-000000000001');
SELECT pg_sleep(3);
COMMIT;
SQL
first_pid=$!

sleep 1
started=$(date +%s)
set +e
psql_su >"$second" 2>&1 <<SQL
BEGIN;
SELECT test.as_person('20000000-0000-7000-8000-000000000002');
INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id)
VALUES ('a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a', '$SESSION',
        '30000000-0000-7000-8000-000000000003', 'reserved', now() + interval '15 minutes', '20000000-0000-7000-8000-000000000002');
COMMIT;
SQL
second_status=$?
waited=$(( $(date +%s) - started ))
wait "$first_pid"; first_status=$?
set -e

bookings=$(psql_su -tAc "SELECT count(*) FROM scheduling.booking WHERE session_id = '$SESSION' AND status = 'reserved'")
counter=$(psql_su -tAc "SELECT reserved_count FROM scheduling.session WHERE id = '$SESSION'")

ok=true
[[ $first_status -eq 0 ]] || { echo "not ok - the first session should commit its booking"; cat "$first"; ok=false; }
[[ $second_status -ne 0 ]] && grep -q "is full" "$second" || { echo "not ok - the second session should be refused as full"; cat "$second"; ok=false; }
(( waited >= 1 )) || { echo "not ok - the second session should have waited for the first (waited ${waited}s)"; ok=false; }
[[ "$bookings" == "1" && "$counter" == "1" ]] || { echo "not ok - expected exactly one booking, found $bookings (counter $counter)"; ok=false; }
rm -f "$first" "$second"

$ok || exit 1
echo "ok - two sessions racing for the last seat: one booked, the other waited ${waited}s and was refused"

# The same race for the last transport seat (M4.5, ADR 0024): two families,
# one bus route with one seat left, each naming a stop.
BUS=80000000-0000-7000-8000-0000000000b5
psql_su >/dev/null 2>&1 <<SQL
BEGIN;
INSERT INTO catalog.service_definition (id, group_id, code, kind, name)
VALUES ('50000000-0000-7000-8000-0000000000b5', 'a0000000-0000-7000-8000-000000000001', 'bus', 'transport', 'School bus');
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status)
VALUES ('60000000-0000-7000-8000-0000000000b5', 'a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a',
        '50000000-0000-7000-8000-0000000000b5', 'e0000000-0000-7000-8000-000000000001', 'bus', 'Bus route', 'published');
INSERT INTO scheduling.transport_route (offering_id, group_id, school_id)
VALUES ('60000000-0000-7000-8000-0000000000b5', 'a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a');
INSERT INTO scheduling.transport_stop (id, group_id, school_id, offering_id, position, name, pickup_time)
VALUES ('94000000-0000-7000-8000-0000000000b5', 'a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a',
        '60000000-0000-7000-8000-0000000000b5', 1, 'Stop', '07:30');
INSERT INTO scheduling.session (id, group_id, school_id, offering_id, starts_at, ends_at, capacity)
VALUES ('$BUS', 'a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a',
        '60000000-0000-7000-8000-0000000000b5', now() + interval '14 days', now() + interval '100 days', 1);
COMMIT;
SQL

seat() {
  cat <<SQL
BEGIN;
SELECT test.as_person('$1');
INSERT INTO scheduling.booking (group_id, school_id, session_id, student_person_id, status, reserved_until, created_by_person_id, transport_stop_id)
VALUES ('a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a', '$BUS',
        '$2', 'reserved', now() + interval '15 minutes', '$1', '94000000-0000-7000-8000-0000000000b5');
$3
COMMIT;
SQL
}
first=$(mktemp); second=$(mktemp)
seat 20000000-0000-7000-8000-000000000001 30000000-0000-7000-8000-000000000001 'SELECT pg_sleep(3);' | psql_su >"$first" 2>&1 &
first_pid=$!
sleep 1
started=$(date +%s)
set +e
seat 20000000-0000-7000-8000-000000000002 30000000-0000-7000-8000-000000000003 '' | psql_su >"$second" 2>&1
second_status=$?
waited=$(( $(date +%s) - started ))
wait "$first_pid"; first_status=$?
set -e

seats=$(psql_su -tAc "SELECT count(*) FROM scheduling.booking WHERE session_id = '$BUS' AND status = 'reserved'")
ok=true
[[ $first_status -eq 0 ]] || { echo "not ok - the first family should get the seat"; cat "$first"; ok=false; }
[[ $second_status -ne 0 ]] && grep -q "is full" "$second" || { echo "not ok - the second family should be refused as full"; cat "$second"; ok=false; }
(( waited >= 1 )) || { echo "not ok - the second family should have waited for the first (waited ${waited}s)"; ok=false; }
[[ "$seats" == "1" ]] || { echo "not ok - expected exactly one seat booked, found $seats"; ok=false; }
rm -f "$first" "$second"

$ok || exit 1
echo "ok - two families racing for the last transport seat: one booked, the other waited ${waited}s and was refused"

# The same race for the last item in stock (M4.6, ADR 0025): two families
# ordering the one remaining shirt; each holds an order line for it.
psql_su >/dev/null 2>&1 <<SQL
BEGIN;
INSERT INTO catalog.service_definition (id, group_id, code, kind, name)
VALUES ('50000000-0000-7000-8000-0000000000c6', 'a0000000-0000-7000-8000-000000000001', 'polo', 'uniform', 'Polo shirt');
INSERT INTO catalog.school_offering (id, group_id, school_id, service_definition_id, billing_entity_id, code, name, status)
VALUES ('60000000-0000-7000-8000-0000000000c6', 'a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a',
        '50000000-0000-7000-8000-0000000000c6', 'e0000000-0000-7000-8000-000000000001', 'polo', 'Polo shirt', 'published');
INSERT INTO catalog.product_variant (id, group_id, school_id, offering_id, sku, on_hand)
VALUES ('95000000-0000-7000-8000-0000000000c6', 'a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a',
        '60000000-0000-7000-8000-0000000000c6', 'POLO-LAST', 1);
INSERT INTO catalog.price_version (id, group_id, offering_id, variant_id, version, unit_amount_minor, price_unit, valid_from)
VALUES ('70000000-0000-7000-8000-0000000000c6', 'a0000000-0000-7000-8000-000000000001', '60000000-0000-7000-8000-0000000000c6',
        '95000000-0000-7000-8000-0000000000c6', 1, 2500, 'one_off', now() - interval '1 day');
INSERT INTO commerce.customer_order (id, group_id, billing_entity_id, payer_person_id, origin, idempotency_key, created_by_person_id) VALUES
  ('92000000-0000-7000-8000-0000000000c1', 'a0000000-0000-7000-8000-000000000001', 'e0000000-0000-7000-8000-000000000001',
   '20000000-0000-7000-8000-000000000001', 'family_portal', 'race-polo-1', '20000000-0000-7000-8000-000000000001'),
  ('92000000-0000-7000-8000-0000000000c2', 'a0000000-0000-7000-8000-000000000001', 'e0000000-0000-7000-8000-000000000001',
   '20000000-0000-7000-8000-000000000002', 'family_portal', 'race-polo-2', '20000000-0000-7000-8000-000000000002');
INSERT INTO commerce.order_line (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, student_person_id,
                                 price_version_id, description, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor) VALUES
  ('92000000-0000-7000-8000-0000000000d1', 'a0000000-0000-7000-8000-000000000001', '92000000-0000-7000-8000-0000000000c1',
   'e0000000-0000-7000-8000-000000000001', 1, '5c000000-0000-7000-8000-00000000000a', '60000000-0000-7000-8000-0000000000c6',
   '30000000-0000-7000-8000-000000000001', '70000000-0000-7000-8000-0000000000c6', 'Polo shirt', 1, 'EUR', 2500, 0, 2500),
  ('92000000-0000-7000-8000-0000000000d2', 'a0000000-0000-7000-8000-000000000001', '92000000-0000-7000-8000-0000000000c2',
   'e0000000-0000-7000-8000-000000000001', 1, '5c000000-0000-7000-8000-00000000000a', '60000000-0000-7000-8000-0000000000c6',
   '30000000-0000-7000-8000-000000000003', '70000000-0000-7000-8000-0000000000c6', 'Polo shirt', 1, 'EUR', 2500, 0, 2500);
COMMIT;
SQL

item() {
  cat <<SQL
BEGIN;
SELECT test.as_person('$1');
INSERT INTO commerce.stock_reservation (group_id, school_id, variant_id, order_line_id, student_person_id, quantity, status, reserved_until, created_by_person_id)
VALUES ('a0000000-0000-7000-8000-000000000001', '5c000000-0000-7000-8000-00000000000a', '95000000-0000-7000-8000-0000000000c6',
        '$2', '$3', 1, 'reserved', now() + interval '15 minutes', '$1');
$4
COMMIT;
SQL
}
first=$(mktemp); second=$(mktemp)
item 20000000-0000-7000-8000-000000000001 92000000-0000-7000-8000-0000000000d1 30000000-0000-7000-8000-000000000001 'SELECT pg_sleep(3);' | psql_su >"$first" 2>&1 &
first_pid=$!
sleep 1
started=$(date +%s)
set +e
item 20000000-0000-7000-8000-000000000002 92000000-0000-7000-8000-0000000000d2 30000000-0000-7000-8000-000000000003 '' | psql_su >"$second" 2>&1
second_status=$?
waited=$(( $(date +%s) - started ))
wait "$first_pid"; first_status=$?
set -e

held=$(psql_su -tAc "SELECT reserved FROM catalog.product_variant WHERE id = '95000000-0000-7000-8000-0000000000c6'")
ok=true
[[ $first_status -eq 0 ]] || { echo "not ok - the first family should get the item"; cat "$first"; ok=false; }
[[ $second_status -ne 0 ]] && grep -q "not enough of this item in stock" "$second" || { echo "not ok - the second family should be refused"; cat "$second"; ok=false; }
(( waited >= 1 )) || { echo "not ok - the second family should have waited for the first (waited ${waited}s)"; ok=false; }
[[ "$held" == "1" ]] || { echo "not ok - expected exactly one item held, found $held"; ok=false; }
rm -f "$first" "$second"

$ok || exit 1
echo "ok - two families racing for the last item in stock: one holds it, the other waited ${waited}s and was refused"
