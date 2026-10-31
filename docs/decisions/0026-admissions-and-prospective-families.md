# 0026 Admissions: prospective families' data

Date: 2026-10-31 · Status: Accepted

## Context

M5 adds admissions: families who do not yet attend ask about a school, apply, are offered a place and enrol. Until they enrol they are not students, guardians or users of the platform, and most of them never will be. Their data is still personal data (GDPR Art. 4), often about a child (Art. 8, recital 38), collected before any contract exists.

The brief asks for separate concepts (person, guardian relationship, enrolment) and that nothing grants access automatically. ADR 0006 gives the privacy records the DPO controls (purposes, retention policies, consent records, subject requests); `privacy.consent_record` and `privacy.pseudonymise_person()` assume a `people.person`.

## Decision

**Prospects are not persons until they enrol.** An inquiry holds the contact details it was sent with, in its own schema `admissions`, and creates no `people.person`, login or guardian relationship. A person, a verified guardian relationship and an enrolment are created only at the hand-off from an accepted offer (M5.4), by staff, in one transaction. A matching e-mail address never links an inquiry or application to an existing family's records or access.

**Minimal fields, stated purpose.** The website form asks for the parent's name and e-mail (required), a telephone number, the child's first name, the year of birth or grade of interest, the intended start and a message (all optional). No date of birth, address, health or special-category data, which would need a further Art. 9 condition. Free text is limited and redacted from the audit log, like every name and contact detail on an inquiry.

**The notice is versioned and recorded.** Each group publishes its admissions privacy notice in `admissions.privacy_notice`, numbered and immutable once published; the form shows the current version and every inquiry records which version the sender saw. The lawful basis is steps at the data subject's request before a contract (Art. 6(1)(b)); this is the DPO's to confirm in `privacy.processing_purpose`. News about open days is a separate, optional consent (Art. 6(1)(a), Art. 7): unticked by default, recorded with its wording version and time, and withdrawable. The development seed's notice is synthetic and must be replaced by the DPO's text before production.

**No tracking of senders.** The API stores no IP address, user agent or cookie for an inquiry; the website keeps no session (ADR 0017). Abuse is limited without them: a hidden field that people leave empty, a cap on inquiries per website per hour (30), and at most one open inquiry per e-mail address and school, checked in the database. A sender over the cap is asked to try later, which says nothing about any address. Otherwise the answer is the same whether the inquiry was recorded, added to an open one from the same address or (with the hidden field filled) dropped, so the form cannot be used to learn whether an address is known.

**Who sees what.** Only staff with `admissions.manage` at the school (principals, school administrators, group administrators) read or work on its inquiries, under row-level security; not teachers, the kitchen, School Life or the CEO, who sees numbers per school only (M5.5). Every write goes through security-definer functions that check the transition; notes on an inquiry are append-only.

**Storage limitation.** Inquiries that did not lead to an enrolment are erased (names, contact details and free text replaced, counts kept for reporting) after the period in an approved `privacy.retention_policy`, and earlier on request (M5.6). As ADR 0006 requires, nothing is erased automatically until the DPO approves a policy; the seed's policy is a draft.

## Consequences

- An inquirer who later applies through the family portal is identified by their own sign-in, not by their inquiry; staff link the two by hand.
- Admissions reporting can count inquiries after erasure, but cannot say who sent them.
- Without IP-based limits a determined sender can still fill the hourly cap of a website; the cap only protects staff from floods. A CAPTCHA would need a third-party service and its own privacy assessment, so it is left out.
