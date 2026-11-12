# 0027 Intakes, applications and invitations to apply

Date: 2026-10-31 · Status: Accepted

## Context

M5.2 lets families apply for a place. ADR 0026 keeps prospective families out of `people.person` until they enrol, and ADR 0016 allows no self-registration: sign-in accounts are created by staff. A family that only sent an inquiry therefore cannot sign in to apply. Families who already attend (a sibling, a move to another school of the group) can.

An application needs more than an inquiry: to place a child in a grade the school needs the child's full name and date of birth. Applying commits the family to a school, so it should come from a guardian who may decide for the child.

## Decision

**Intakes.** Admissions staff open an intake per school, school year (`2027/28`) and grade, with a number of places and the dates between which applications are taken, in the school's time zone. Open intakes are readable by every signed-in person of the group, like published offerings; closed ones only by the school's admissions staff.

**Applications.** A signed-in parent applies for:
- one of their own children, as a guardian with the `consent` capability; the school already holds the child's details, so the application adds none; or
- a child the group does not know yet, giving the child's given and family name and date of birth (required, for the grade), and optionally their current school and a message. These stay on the application, not in `people.person`, until the hand-off (M5.4).

The application records the admissions privacy notice version the parent saw (ADR 0026, `PY020`). It is refused outside the intake's dates or once the intake is closed (`PY022`), and there is at most one live application per child and intake. States: submitted, under review (staff), withdrawn (the parent, at any time before a decision); M5.3 adds offers. The parent who applied sees the application; no other family member does, and staff see it only with `admissions.manage` at its school. Those staff may also read the person records of the child and the parent who applied (name, date of birth, e-mail), even when the family belongs to another school, and nothing else about them. The child's details and the message are redacted from the audit log.

**Invitations.** Staff with `admissions.manage` can invite the sender of an open inquiry to apply. If no active person in the group has that e-mail address, the invitation creates the parent's `people.person` (registered at the inquiry's school, with the name staff confirm) and a sign-in account through the provisioning service account (ADR 0016), and links the inquiry to them. If the address is already known, nothing is created or linked: an existing record may belong to someone else sharing the address, so an e-mail match never yields access (the brief, ADR 0026). Staff are told only that the address is known and that a group administrator can help. Linking the login is done by a narrow security-definer function that accepts only a person created for an inquiry at a school where the caller handles admissions, with no login, role or guardian relationship yet.

## Consequences

- The parent becomes a person once invited, the child only when enrolled. The parent's record is personal data with a login; it falls under the group's normal retention, while unsuccessful applications are erased with the inquiries (M5.6).
- Principals and school administrators can create sign-in accounts, but only for brand-new applicant parents, never for staff or existing families; group administrators keep the general account function.
- In development the invitation returns a one-time temporary password, as the M3.2 accounts do; production must send the "set your password" e-mail (needs SMTP, M7).
