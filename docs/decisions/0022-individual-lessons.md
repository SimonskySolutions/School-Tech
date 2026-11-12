# 0022 Individual lessons: teachers, rooms, slots and packages

Date: 2026-10-31 · Status: Accepted

## Context

The brief asks for individual lessons with teacher and room availability, session bookings, packages and cancellation rules (M4.3). Lunch and clubs have one kind of limited capacity: places on a session. Lessons add two more: a teacher and a room can each be in only one place at a time, and a family pays for a number of lessons before choosing when they happen.

## Decision

- **Teachers and rooms are resources of a school** (`scheduling.resource`, kind `teacher` or `room`). A teacher may be linked to their person record; every resource has a display name, which is what parents see, so parents never read staff person records. Each resource has **weekly availability** (`scheduling.resource_availability`: weekday, from, to, in the school's local time).
- **A lesson slot is a session** of a `lesson` offering, with capacity 1, a teacher and a room (`scheduling.session_resource`, one row per resource, holding the slot's time range). An **exclusion constraint** on (resource, time range) means a teacher or a room can never be booked into two slots that overlap, whatever writes them; a slot outside the resource's weekly availability is refused by a trigger. Slots are created by `scheduling.create_lesson_slots(offering, teacher, room, from, to, minutes)`, which fills each day's shared availability of the teacher and the room with back-to-back slots and skips any that would overlap. Staff with `catalog.manage` (administrators, School Life, principals) do this; the slot's cancellation cutoff is 24 hours before it starts.
- **Lessons are sold as packages through the normal checkout.** A lesson offering's price is `per_package` with a `package_size` (a single lesson is a package of 1). The order line books nothing; when the worker confirms the paid line, a trigger creates the child's **package** (`scheduling.lesson_package`) in the same transaction, with an opening entry in its **ledger** (`scheduling.package_entry`, append-only). The balance is always the sum of the ledger.
- **Booking a slot uses a lesson from the package**, through `scheduling.book_lesson(slot, child, package)`. It checks that the caller manages the child's bookings, that the package is the child's, for this offering and not empty, and the child's eligibility; the booking is confirmed at once and the ledger gets −1, all in one transaction. The slot's capacity counter takes the row lock, so two families racing for the last slot cannot both get it (`PY002`), and the package row is locked so two bookings cannot spend the same last lesson (`PY014`).
- **Cancellation rules:** `scheduling.cancel_lesson(booking)`, by the family or by staff with `bookings.manage`, before the lesson starts. Before the cutoff the lesson goes back to the package (+1); after it the lesson counts as used. Either way the slot is free again for someone else.

## Consequences

- One price per lesson offering: a school offering both single lessons and a 10-lesson package creates two offerings with the same teacher and room.
- Unused lessons in a package do not expire and are not refunded automatically; expiry and refunds of unused lessons are decisions for later, and finance can issue credit by hand meanwhile.
- Teachers do not yet see "my timetable" as a page; staff see slots and bookings per school. Marking lesson attendance uses the registers (ADR 0021).
