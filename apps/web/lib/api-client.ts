import {
  type ActivityRegisters,
  type CancelBookingResponse,
  type CheckoutGroupView,
  type CheckoutRequestBody,
  type CheckoutResponse,
  type DietaryReview,
  type KitchenCounts,
  type LunchList,
  type LunchMenus,
  type RevenueReport,
  type SchoolInquiries,
  type SchoolLessons,
  type SchoolLifeDay,
  type SchoolRequests,
  type SchoolSetup,
  type SchoolTransport,
  type SchoolUniforms,
  type StudentList,
  type MeResponse,
  type OnboardingOverview,
  type SchoolSummary,
  type StudentActivities,
  type StudentDietary,
  type StudentLessons,
  type StudentOfferings,
  type StudentRequests,
  type StudentTrips,
  type TransportRuns,
  type TripParticipants,
} from '@pythagoras/shared';

// Server-side calls from the web app to the API, with the signed-in person's
// access token. The token is attached here and never sent to the browser.

export type ApiResult<T> =
  { kind: 'ok'; value: T } | { kind: 'signed-out' } | { kind: 'unlinked' } | { kind: 'not-found' };

async function get<T>(apiUrl: string, path: string, accessToken: string): Promise<ApiResult<T>> {
  const response = await fetch(new URL(path, apiUrl), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (response.status === 401) return { kind: 'signed-out' };
  if (response.status === 403) return { kind: 'unlinked' };
  if (response.status === 404) return { kind: 'not-found' };
  if (!response.ok) throw new Error(`API ${path} answered ${response.status}`);
  return { kind: 'ok', value: (await response.json()) as T };
}

export const fetchMe = (apiUrl: string, accessToken: string) => get<MeResponse>(apiUrl, '/me', accessToken);

export const fetchSchools = (apiUrl: string, accessToken: string) =>
  get<SchoolSummary[]>(apiUrl, '/schools', accessToken);

export const fetchOfferings = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentOfferings>(apiUrl, `/students/${encodeURIComponent(studentId)}/offerings`, accessToken);

export const fetchCheckoutGroup = (apiUrl: string, accessToken: string, groupId: string) =>
  get<CheckoutGroupView>(apiUrl, `/checkout-groups/${encodeURIComponent(groupId)}`, accessToken);

export type CheckoutResult = { kind: 'ok'; value: CheckoutResponse } | { kind: 'refused'; status: number };

/** Places the orders. The idempotency key makes a double submit return the same checkout. */
export async function postCheckout(
  apiUrl: string,
  accessToken: string,
  idempotencyKey: string,
  body: CheckoutRequestBody,
): Promise<CheckoutResult> {
  const response = await fetch(new URL('/checkout', apiUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) return { kind: 'refused', status: response.status };
  return { kind: 'ok', value: (await response.json()) as CheckoutResponse };
}

const range = (from: string | null, days: number | null) => {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (days) query.set('days', String(days));
  return query.size ? `?${query}` : '';
};

export const fetchKitchenCounts = (
  apiUrl: string,
  accessToken: string,
  from: string | null,
  days: number | null,
) => get<KitchenCounts>(apiUrl, `/school-life/kitchen${range(from, days)}`, accessToken);

export const fetchRegisters = (
  apiUrl: string,
  accessToken: string,
  from: string | null,
  days: number | null,
) => get<ActivityRegisters>(apiUrl, `/school-life/registers${range(from, days)}`, accessToken);

export const fetchRevenueReport = (
  apiUrl: string,
  accessToken: string,
  period: { from: string; to: string } | null,
) =>
  get<RevenueReport>(
    apiUrl,
    `/reports/revenue${period ? `?${new URLSearchParams(period)}` : ''}`,
    accessToken,
  );

export const fetchLunchList = (apiUrl: string, accessToken: string, schoolId: string, date: string) =>
  get<LunchList>(apiUrl, `/school-life/lunch?${new URLSearchParams({ schoolId, date })}`, accessToken);

export type CancelResult = { kind: 'ok'; value: CancelBookingResponse } | { kind: 'refused'; status: number };

/** Cancels one paid lunch day as the signed-in member of staff. */
export async function postCancelBooking(
  apiUrl: string,
  accessToken: string,
  bookingId: string,
  reason: string,
): Promise<CancelResult> {
  const response = await fetch(
    new URL(`/school-life/bookings/${encodeURIComponent(bookingId)}/cancel`, apiUrl),
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
      cache: 'no-store',
    },
  );
  if (!response.ok) return { kind: 'refused', status: response.status };
  return { kind: 'ok', value: (await response.json()) as CancelBookingResponse };
}

export const fetchOnboarding = (apiUrl: string, accessToken: string) =>
  get<OnboardingOverview>(apiUrl, '/admin/onboarding', accessToken);

export const fetchSchoolSetup = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<SchoolSetup>(apiUrl, `/admin/schools/${encodeURIComponent(schoolId)}`, accessToken);

export type AdminResult<T> = { kind: 'ok'; value: T } | { kind: 'refused'; status: number; message: string };

/** A school set-up write as the signed-in administrator; the API's refusal message is kept for the page. */
export const postAdmin = <T>(apiUrl: string, accessToken: string, path: string, body?: unknown) =>
  writeApi<T>(apiUrl, accessToken, 'POST', path, body);

/** A write as the signed-in person; the API's refusal message is kept for the page. */
export async function writeApi<T>(
  apiUrl: string,
  accessToken: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<AdminResult<T>> {
  const response = await fetch(new URL(path, apiUrl), {
    method,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await response.json().catch(() => ({}))) as { message?: unknown };
  if (!response.ok) {
    const message = typeof json.message === 'string' ? json.message : `the API answered ${response.status}`;
    return { kind: 'refused', status: response.status, message };
  }
  return { kind: 'ok', value: json as T };
}

export const fetchStudents = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<StudentList>(apiUrl, `/schools/${encodeURIComponent(schoolId)}/students`, accessToken);

export const fetchLunchMenus = (
  apiUrl: string,
  accessToken: string,
  from: string | null,
  days: number | null,
) => get<LunchMenus>(apiUrl, `/school-life/menus${range(from, days)}`, accessToken);

export const fetchStudentDietary = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentDietary>(apiUrl, `/students/${encodeURIComponent(studentId)}/dietary`, accessToken);

export const fetchDietaryReview = (apiUrl: string, accessToken: string) =>
  get<DietaryReview>(apiUrl, '/school-life/dietary', accessToken);

export const fetchStudentActivities = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentActivities>(apiUrl, `/students/${encodeURIComponent(studentId)}/activities`, accessToken);

export const fetchStudentLessons = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentLessons>(apiUrl, `/students/${encodeURIComponent(studentId)}/lessons`, accessToken);

export const fetchSchoolLessons = (
  apiUrl: string,
  accessToken: string,
  schoolId: string,
  from: string | null,
) =>
  get<SchoolLessons>(
    apiUrl,
    `/schools/${encodeURIComponent(schoolId)}/lessons${range(from, 14)}`,
    accessToken,
  );

export const fetchStudentTrips = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentTrips>(apiUrl, `/students/${encodeURIComponent(studentId)}/trips`, accessToken);

export const fetchTripParticipants = (apiUrl: string, accessToken: string, from: string | null) =>
  get<TripParticipants>(apiUrl, `/school-life/trips${range(from, 31)}`, accessToken);

export const fetchSchoolTransport = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<SchoolTransport>(apiUrl, `/schools/${encodeURIComponent(schoolId)}/transport`, accessToken);

export const fetchTransportRuns = (apiUrl: string, accessToken: string, date: string | null) =>
  get<TransportRuns>(apiUrl, `/school-life/transport${date ? `?date=${date}` : ''}`, accessToken);

export const fetchSchoolUniforms = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<SchoolUniforms>(apiUrl, `/schools/${encodeURIComponent(schoolId)}/uniforms`, accessToken);

export const fetchStudentRequests = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentRequests>(apiUrl, `/students/${encodeURIComponent(studentId)}/requests`, accessToken);

export const fetchSchoolRequests = (apiUrl: string, accessToken: string, status: string) =>
  get<SchoolRequests>(apiUrl, `/school-life/requests?${new URLSearchParams({ status })}`, accessToken);

export const fetchSchoolLifeDay = (
  apiUrl: string,
  accessToken: string,
  schoolId: string | null,
  date: string | null,
) => {
  const query = new URLSearchParams();
  if (schoolId) query.set('schoolId', schoolId);
  if (date) query.set('date', date);
  return get<SchoolLifeDay>(apiUrl, `/school-life/day?${query}`, accessToken);
};

export const fetchSchoolInquiries = (apiUrl: string, accessToken: string, status: string) =>
  get<SchoolInquiries>(apiUrl, `/admissions/inquiries?${new URLSearchParams({ status })}`, accessToken);
