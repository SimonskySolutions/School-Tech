# 0023 Trips and guardian consent

Date: 2026-10-31 · Status: Accepted

## Context

The brief asks for trips with consent and participant management (M4.4). A trip is one outing with limited places, a price, and a permission that a guardian gives for that trip specifically. The trip's staff need to know who is coming, that each child's guardian has agreed, whom to call in an emergency, and which children have dietary or health needs.

## Decision

- **A trip is an offering of kind `trip` with one session** (start, end, place, capacity), bought through the normal checkout like a club. The set-up page creates the session with a new one-off calendar.
- **The consent wording is a versioned policy text** of the offering (`catalog.policy_version` kind `trip_consent`, the wording in `terms_text`). Policy versions are immutable, so a permission always points at the exact words the guardian agreed to. Changing the wording makes a new version; permissions given to an older version no longer allow a new booking.
- **Trip permission is its own record** (`scheduling.trip_permission`), not a GDPR consent (`privacy.consent_record`, ADR 0006): it is a guardian's permission for an outing, not consent to process data, and mixing the two would blur both. Only a guardian with the `can_consent` capability gives it for their child (from the family portal), or staff with `consent.manage` record one given on paper or in person. It holds an emergency contact for the day. One live permission per child and trip.
- **No booking without permission.** A trigger on new bookings of a trip session refuses a child without a given permission for the trip's current wording (`PY016`), whatever the request; the catalogue shows parents that permission is needed first.
- **Withdrawing permission before the trip cancels the place.** `scheduling.withdraw_trip_permission` (the guardian, or staff with `consent.manage`) marks it withdrawn and, if the child is booked and paid, cancels the booking and the order line and asks the worker for credit of what was paid (the M2.8 path, ADR 0008). While a payment for the trip is still pending, withdrawal is refused (`PY017`) until the payment completes or the reservation expires, so a late payment can never book a child without permission. After the trip has started nothing can be withdrawn.
- **The participant list** (`GET /school-life/trips`) shows the trip's staff (`bookings.read` at the school) each booked child with class, permission (who gave it, when, how) and the emergency contact; dietary and health needs only to those with `sensitive.dietary.read`, logged as every such read is (ADR 0006, 0020).

## Consequences

- Guardians without the consent capability see that another guardian must give permission.
- The emergency contact is personal data kept with the permission; it follows the retention rules for trip records once the data protection officer approves them (ADR 0006).
- Multi-day trips, transport to the trip and per-trip risk assessments are not modelled.
