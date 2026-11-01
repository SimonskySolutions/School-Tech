# 0030 Consent from families

Date: 2026-11-01 · Status: Accepted

## Context

Schools want to show children in photos on their websites and in printed materials, and to share recordings of performances. Publishing a child's image needs consent (GDPR Art. 6(1)(a)), given for the child by a holder of parental responsibility (Art. 8 and Bulgarian law for children under 14; the school asks the guardians of every pupil, whatever their age). Consent must be informed, specific, recorded with what the person agreed to, and as easy to withdraw as to give (Art. 7). Staff taking photos need to know, simply, who may appear.

The data layer already has `privacy.processing_purpose` (the record of processing, approved by the data protection officer) and `privacy.consent_record` (ADR 0006), so far unused. Permission for a trip is not a consent to process data and stays with the trip (ADR 0023).

## Decision

**A family consent is for an approved purpose with published wording.** The purposes guardians are asked about are processing purposes whose lawful basis is consent, approved by the data protection officer, with at least one published wording. The wording lives in `privacy.consent_wording`, append-only and numbered per purpose. Only `privacy.manage` (the data protection officer) publishes it. A consent record points at the exact wording it was given for (`wording_id`, with `wording_version` holding its number).

**New wording, and when to ask again.** Publishing a wording says whether earlier consents still count. A correction that does not change what is agreed keeps them. A change of substance (`renewal_required`) means every consent given for an earlier version stops counting, and guardians are asked again. No consent is ever moved silently to new words.

**Given and withdrawn in the portal, by a guardian who may consent.** Only an active, verified guardian with the `can_consent` capability gives consent for the child (`privacy.give_consent`), and only for the purpose's latest wording. Any such guardian, or staff with `consent.manage` recording a withdrawal received on paper, withdraws it (`privacy.withdraw_consent`) with one click. Withdrawal takes effect at once; it does not undo what was lawfully published before it. Writes to `privacy.consent_record` go only through these functions now. The direct insert and update grants of ADR 0006 are revoked, so a record always names a published wording.

**Staff see only what they need.** `privacy.school_consents(school)` gives staff who read the school's enrolments (`enrolment.read`: principals, school administrators, teachers, the group's leaders and School Life) each pupil enrolled now and, per purpose, whether consent counts: yes, no, or asked again. They do not see who gave it or when. That stays with the guardians, the data protection officer and staff with `consent.manage`, who already read consent records.

**Purposes in the development seed** (synthetic wording, to be replaced by the data protection officer): photos on the school's website and social media; photos in printed school materials; recordings of school performances shared with the class's families.

## Consequences

- Consent given on paper is recorded by staff with `consent.manage` in a later step; until then paper consents are not entered, and staff should treat such children as not consenting.
- Children who become old enough to decide for themselves are not yet asked themselves.
- The retention of consent records follows the purpose's retention policy once the data protection officer approves it (ADR 0006); withdrawn records are kept as evidence of what was agreed and when.
- Nobody is notified when wording changes and consent is asked again; families see it on their child's page (notifications are M7).
