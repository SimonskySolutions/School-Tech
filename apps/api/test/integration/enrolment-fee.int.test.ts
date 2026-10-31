import { type CheckoutResponse, type FamilyAdmissions, type SchoolApplications } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, invitedParent, payAndWait, post, tokenFor } from './helpers';

// The enrolment fee (M5.8) against the real stack. The principal of School A
// charges the seeded enrolment fee (150.00) on an intake of its own; a new
// family's child is enrolled from it; the parent pays the fee once through
// the common checkout, to School A's company; it cannot be bought twice.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const FEE = 'd2000000-0000-7000-8000-0000000000af';
const LUNCH_A = 'd2000000-0000-7000-8000-0000000000a1';
const run = Date.now().toString(36);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const tokens: Record<string, string> = {};
let intakeId: string;
let applicationId: string;
let childId: string;

const fee = async () =>
  (await get<FamilyAdmissions>('/admissions/family', tokens.parent!)).body.applications.find(
    (application) => application.id === applicationId,
  )!.fee;
const checkout = async (token: string) => {
  const response = await fetch(`${API}/checkout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({ items: [{ studentId: childId, offeringId: FEE }] }),
  });
  return { status: response.status, body: (await response.json()) as CheckoutResponse };
};

beforeAll(async () => {
  for (const user of ['principal.a', 'principal.c', 'anna.ivanova']) tokens[user] = await tokenFor(user);
  tokens.parent = (await invitedParent(tokens['principal.a']!, 'Fee')).token;
  intakeId = (
    await post<{ id: string }>(tokens['principal.a']!, '/admissions/intakes', {
      schoolId: SCHOOL_A,
      schoolYear: '2028/29',
      grade: `f${run}`,
      places: 3,
      opensOn: day(0),
      closesOn: day(30),
    })
  ).body.id;
});

describe('the enrolment fee', () => {
  it('is set on an intake by its school’s admissions staff, as a fee offering of that school', async () => {
    const path = `/admissions/intakes/${intakeId}/fee`;
    expect((await post(tokens['principal.c']!, path, { offeringId: FEE })).status).toBe(404);
    expect((await post(tokens['principal.a']!, path, { offeringId: LUNCH_A })).status).toBe(422);
    expect((await post(tokens['principal.a']!, path, { offeringId: FEE })).status).toBe(200);
    const view = (
      await get<SchoolApplications>(`/admissions/applications?intakeId=${intakeId}`, tokens['principal.a']!)
    ).body;
    expect(view.intakes.find((intake) => intake.id === intakeId)!.fee).toEqual({
      offeringId: FEE,
      name: 'Enrolment fee, School A',
      amountMinor: 15000,
      currency: 'EUR',
    });
    expect(view.fees.map((option) => option.id)).toContain(FEE);
  });

  it('is due once the child is enrolled, and paid once through the checkout', async () => {
    const noticeId = (await get<FamilyAdmissions>('/admissions/family', tokens.parent!)).body.notice!.id;
    applicationId = (
      await post<{ id: string }>(tokens.parent!, '/admissions/applications', {
        intakeId,
        noticeId,
        child: { givenName: 'Fia', familyName: 'Test', birthDate: '2021-03-03' },
      })
    ).body.id;
    expect(await fee()).toBeNull();
    const act = (user: string, what: string, body?: unknown) =>
      post<{ studentId?: string }>(tokens[user]!, `/admissions/applications/${applicationId}/${what}`, body);
    await act('principal.a', 'offer', { answerBy: day(7) });
    await act('parent', 'answer', { accept: true });
    // From September: the fee may be paid before the enrolment starts.
    childId = (await act('principal.a', 'enrol', { startDate: '2028-09-15', relationship: 'father' })).body
      .studentId!;
    expect(await fee()).toMatchObject({ offeringId: FEE, amountMinor: 15000, state: 'due' });

    // Another family does not even see the child.
    expect((await checkout(tokens['anna.ivanova']!)).status).toBe(404);
    const placed = await checkout(tokens.parent!);
    expect(placed.status).toBe(201);
    expect(placed.body.orders).toEqual([
      expect.objectContaining({ billingEntityName: 'Testing Company', totalMinor: 15000 }),
    ]);
    expect((await fee())!.state).toBe('open');
    expect((await checkout(tokens.parent!)).status).toBe(409);
    await payAndWait(tokens.parent!, placed.body);
    expect((await fee())!.state).toBe('paid');
    expect((await checkout(tokens.parent!)).status).toBe(409);
  });
});
