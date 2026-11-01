# 0028 Staff records

Date: 2026-11-01 · Status: Accepted

## Context

M6 adds staff records, qualifications, documents, approvals and tasks. Today a member of staff is a `people.person` with role assignments (`access.role_assignment`), which say what they may do in the platform. Nothing records their employment: who employs them, where they work, in which position, on what contract and since when.

Employee data is personal data processed for the employment contract and under labour and tax law (GDPR Art. 6(1)(b) and (c), Art. 88). Bulgarian statutory payroll and official reporting are external integrations whose contracts are not confirmed (the brief, `docs/integration-register.md`); the platform must not pretend to be a payroll system.

## Decision

**Access and employment stay separate.** A role assignment says what someone may do; a `staff.employment` record says that a legal entity employs them, at a school (or group-wide), in a position, from a date, on a contract with a working-time fraction. A person may hold several employments (two schools, two employers, consecutive contracts). Ending an employment does not revoke roles, and revoking a role does not end an employment; the staff page shows where the two disagree.

**Minimal fields.** Position, contract kind (permanent, fixed term, temporary), working-time fraction, start and end dates, the employer (an `org.legal_entity`) and the workplace, and a work e-mail and telephone. Not stored: national identification number (ЕГН), home address, salary, bank details, health data or anything payroll needs; those stay with the payroll provider until its integration contract is agreed (M7).

**Who sees what.** The member of staff sees their own employments. Staff with `staff.read` at the workplace (principals and school administrators at their school; group administrators and the CEO for the group) see the records; `staff.manage` (principals, school administrators, group administrators) records and ends them. Teachers, the kitchen and School Life do not see colleagues' employment records. Every write goes through security-definer functions that check the permission at the workplace and that the employer is a legal entity of the group.

**Checks and qualifications (M6.2).** Criminal record certificates are data about convictions (Art. 10): the platform records only that a valid certificate was seen, when, until when it is valid and by whom, never its content or a copy.

## Consequences

- HR reporting (head counts, working time per school) can be built from employments without touching payroll data.
- Retention of employment records follows labour-law periods the DPO and HR set; no automatic erasure is built for them yet.
- Payroll, contracts of employment as documents and leave are out of scope until the payroll integration and the document store (M6.4) exist.
