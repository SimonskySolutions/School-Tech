# 0021 Activity eligibility and attendance

Date: 2026-10-30 · Status: Accepted

## Context

The brief asks for activities with eligibility, schedules, capacity, enrolment and attendance registers (M4.2). Schedules, capacity and enrolment (bookings) exist since M2. `catalog.school_offering.eligibility` existed since M0 as free JSON that nothing read, and registers were read-only.

## Decision

- **Eligibility has a fixed shape**, checked by the database (`catalog.is_valid_eligibility`): `{"grades": [...], "min_age": n, "max_age": n}`, each part optional. Grades are the child's grade at the offering's school (`people.enrolment.grade_level`), as text, because schools name grades differently ("3", "group 2"). Ages are whole years on the day of the session, in the school's time zone; an age rule needs a recorded date of birth.
- **Every new booking is checked in the database** (`scheduling.check_eligibility`, error `PY012`), on that session's own day, whatever the request contains. `catalog.eligibility_problem(offering, child, day)` gives the reason in words. The catalogue shows it to the parent and the checkout refuses with it before anything is written. It says nothing about a child the caller may not see, so it cannot be used to learn about other families' children; row-level security then refuses the booking itself.
- **Changing the rules does not touch bookings already made.** A group administrator sets the rules when adding an offering and changes them on the school's set-up page (`PUT /admin/schools/:id/offerings/:offeringId/eligibility`).
- **Attendance is marked only through `scheduling.mark_attendance(booking, status)`**, which checks the new permission `attendance.mark` (teachers, principals, school administrators, School Life) at the booking's school, refuses before the session starts (`PY013`) and refuses unpaid bookings. It records who marked it and when on the booking (`attendance_marked_by_person_id`, `attendance_marked_at`); corrections between attended and absent are allowed and recorded the same way, and the audit log keeps every change. Teachers still cannot change bookings in any other way.
- **Parents see attendance** for their own children (`GET /students/:id/activities`, the "Clubs and attendance" page).

## Consequences

- Any teacher at the school can mark any club's register there; assigning a club to particular staff is not modelled yet (it may come with lessons and staff records, M4.3 and M6).
- A child without a date of birth cannot book an offering with an age rule; the school records the date of birth first.
- Lunch and other kinds can use the same eligibility rules; nothing else changes for them.
