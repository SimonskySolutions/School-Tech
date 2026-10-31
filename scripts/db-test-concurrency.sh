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
