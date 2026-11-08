# 0040 Running the schools from one place

Date: 2026-11-05 · Status: Accepted

## Context

The group wants one system that manages all its schools: websites, classes and full classes, schedules, reserved places, purchases, inventories and accounting. The portal already sold lunches, clubs and uniforms, but a class was only a text label on an enrolment, and stock, spending and the timetable lived elsewhere.

## Decision

- **Classes are rows with a limit.** `scheduling.school_class` holds the capacity, and the database refuses a child beyond it (`PY027`), however the child arrives. `class_label` stays on the enrolment and follows the class.
- **The timetable is guarded by unique constraints.** One lesson per class, teacher and room in each period, so a clash cannot be saved even by two people at once.
- **The register and grades are their own schema**, `academic`. Families read their own child's; teachers and school leaders keep them (`class.teach`). Grades use the Bulgarian scale, 2 to 6.
- **Stock is a count kept by movements.** `inventory.item.on_hand` is written only by the trigger on `inventory.movement`, so every change has a reason and stock cannot go below zero (`PY030`). Uniforms keep their own stock in `catalog`, since they are sold.
- **Spending sits beside income, not inside it.** `finance` holds expenses and budgets. Income comes from the existing payment allocations through `finance.school_income`, which gives a total without showing any family's payments. Payroll stays in the accountants' own system.
- **Each paid order gets an invoice**, numbered without gaps per company by locking the company's row.
- **A waiting list tells, it does not hold.** When a seat comes free in every meeting still to come, the first child is told and the place is theirs to book. Another family can still book it first; holding seats would need reservations with an expiry, which is left for when the group asks for it.
- **The group overview reads across schools** only for people with the rights to each school's figures.

## Consequences

- Each school's numbers are protected by the same row-level security as the rest of the system.
- The invoices are a family's receipt in the portal, not yet tax documents: an accountant must check their wording and numbering before real use.
- Most family and staff pages are still in English; the shell, navigation and home page are in both languages (ADR 0039).
