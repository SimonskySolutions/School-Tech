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
  type AdmissionsPipeline,
  type FamilyAdmissions,
  type SchoolApplications,
  type MyStaffRecords,
  type SchoolInquiries,
  type SchoolStaff,
  type SchoolDocuments,
  type MyApprovals,
  type MyTasks,
  type MyNotifications,
  type AccountingCompanies,
  type AccountingSummary,
  type ProjectView,
  type ConsentPurposes,
  type SchoolConsents,
  type StudentConsents,
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
  type ClassDetail,
  type GroupOverview,
  type InvoiceDetail,
  type MyInvoices,
  type SchoolFinance,
  type SchoolInventory,
  type SchoolWaitingLists,
  type StudentWaitingList,
  type ClassRegister,
  type StudentProgress,
  type SchoolClasses,
  type SchoolTimetable,
  type StudentTimetable,
  type TimetableView,
} from '@pythagoras/shared';

// Server-side calls from the web app to the API, with the signed-in person's
// access token. The token is attached here and never sent to the browser.

export type ApiResult<T> =
  | { kind: 'ok'; value: T }
  // secondFactor: staff signed in without it (M8.3); signing in again asks for it.
  | { kind: 'signed-out'; secondFactor?: true }
  | { kind: 'unlinked' }
  | { kind: 'not-found' };

const SECOND_FACTOR_REQUIRED = 'second_factor_required';

/** Whether a 403 from the API means staff must sign in with the second factor. */
async function needsSecondFactor(response: Response): Promise<boolean> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return body?.error === SECOND_FACTOR_REQUIRED;
}

async function get<T>(apiUrl: string, path: string, accessToken: string): Promise<ApiResult<T>> {
  const response = await fetch(new URL(path, apiUrl), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (response.status === 401) return { kind: 'signed-out' };
  if (response.status === 403) {
    return (await needsSecondFactor(response))
      ? { kind: 'signed-out', secondFactor: true }
      : { kind: 'unlinked' };
  }
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

export const fetchSchoolClasses = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<SchoolClasses>(apiUrl, `/schools/${encodeURIComponent(schoolId)}/classes`, accessToken);

export const fetchClassDetail = (apiUrl: string, accessToken: string, schoolId: string, classId: string) =>
  get<ClassDetail>(
    apiUrl,
    `/schools/${encodeURIComponent(schoolId)}/classes/${encodeURIComponent(classId)}`,
    accessToken,
  );

export const fetchSchoolTimetable = (
  apiUrl: string,
  accessToken: string,
  schoolId: string,
  view: TimetableView,
  of: string | null,
) =>
  get<SchoolTimetable>(
    apiUrl,
    `/schools/${encodeURIComponent(schoolId)}/timetable?${new URLSearchParams({ view, ...(of ? { of } : {}) })}`,
    accessToken,
  );

export const fetchStudentTimetable = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentTimetable>(apiUrl, `/students/${encodeURIComponent(studentId)}/timetable`, accessToken);

export const fetchClassRegister = (
  apiUrl: string,
  accessToken: string,
  schoolId: string,
  classId: string,
  day: string,
) =>
  get<ClassRegister>(
    apiUrl,
    `/schools/${encodeURIComponent(schoolId)}/classes/${encodeURIComponent(classId)}/register?${new URLSearchParams({ day })}`,
    accessToken,
  );

export const fetchStudentProgress = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentProgress>(apiUrl, `/students/${encodeURIComponent(studentId)}/progress`, accessToken);

export const fetchSchoolInventory = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<SchoolInventory>(apiUrl, `/schools/${encodeURIComponent(schoolId)}/inventory`, accessToken);

export const fetchSchoolFinance = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<SchoolFinance>(apiUrl, `/schools/${encodeURIComponent(schoolId)}/finance`, accessToken);

export const fetchGroupOverview = (apiUrl: string, accessToken: string) =>
  get<GroupOverview>(apiUrl, '/group/overview', accessToken);

export const fetchMyInvoices = (apiUrl: string, accessToken: string) =>
  get<MyInvoices>(apiUrl, '/me/invoices', accessToken);

export const fetchInvoice = (apiUrl: string, accessToken: string, invoiceId: string) =>
  get<InvoiceDetail>(apiUrl, `/me/invoices/${encodeURIComponent(invoiceId)}`, accessToken);

export const fetchStudentWaitingList = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentWaitingList>(apiUrl, `/students/${encodeURIComponent(studentId)}/waiting-list`, accessToken);

export const fetchSchoolWaitingLists = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<SchoolWaitingLists>(apiUrl, `/schools/${encodeURIComponent(schoolId)}/waiting-lists`, accessToken);

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

export const fetchFamilyAdmissions = (apiUrl: string, accessToken: string) =>
  get<FamilyAdmissions>(apiUrl, '/admissions/family', accessToken);

export const fetchSchoolApplications = (apiUrl: string, accessToken: string, intakeId: string | null) =>
  get<SchoolApplications>(
    apiUrl,
    `/admissions/applications${intakeId ? `?${new URLSearchParams({ intakeId })}` : ''}`,
    accessToken,
  );

export const fetchAdmissionsPipeline = (apiUrl: string, accessToken: string, since: string | null) =>
  get<AdmissionsPipeline>(
    apiUrl,
    `/admissions/pipeline${since ? `?${new URLSearchParams({ since })}` : ''}`,
    accessToken,
  );

export const fetchSchoolStaff = (
  apiUrl: string,
  accessToken: string,
  schoolId: string,
  year: string | null = null,
) =>
  get<SchoolStaff>(
    apiUrl,
    `/schools/${encodeURIComponent(schoolId)}/staff${year ? `?${new URLSearchParams({ year })}` : ''}`,
    accessToken,
  );

export const fetchMyEmployments = (apiUrl: string, accessToken: string) =>
  get<MyStaffRecords>(apiUrl, '/staff/me', accessToken);

// Documents (M6.4, ADR 0029).

export const fetchSchoolDocuments = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<SchoolDocuments>(apiUrl, `/schools/${encodeURIComponent(schoolId)}/documents`, accessToken);

/** The file as the request body, its name percent-encoded in X-File-Name. */
export async function uploadDocumentFile(
  apiUrl: string,
  accessToken: string,
  documentId: string,
  file: { bytes: ArrayBuffer; type: string; name: string },
): Promise<AdminResult<{ versionId: string; versionNo: number }>> {
  const response = await fetch(new URL(`/documents/${encodeURIComponent(documentId)}/file`, apiUrl), {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': file.type,
      'x-file-name': encodeURIComponent(file.name),
    },
    body: file.bytes,
    cache: 'no-store',
  });
  const json = (await response.json().catch(() => ({}))) as { message?: unknown };
  if (!response.ok) {
    const message = typeof json.message === 'string' ? json.message : `the API answered ${response.status}`;
    return { kind: 'refused', status: response.status, message };
  }
  return { kind: 'ok', value: json as { versionId: string; versionNo: number } };
}

export const fetchMyApprovals = (apiUrl: string, accessToken: string) =>
  get<MyApprovals>(apiUrl, '/documents/approvals/waiting', accessToken);

/** Redeems a download link for the signed-in person: the API's response, streamed on as it is. */
export const fetchDocumentFile = (apiUrl: string, accessToken: string, token: string) =>
  fetch(new URL(`/documents/files/${encodeURIComponent(token)}`, apiUrl), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

// Consent from families (M6.6, ADR 0030).

export const fetchStudentConsents = (apiUrl: string, accessToken: string, studentId: string) =>
  get<StudentConsents>(apiUrl, `/students/${encodeURIComponent(studentId)}/consents`, accessToken);

export const fetchSchoolConsents = (apiUrl: string, accessToken: string, schoolId: string) =>
  get<SchoolConsents>(apiUrl, `/schools/${encodeURIComponent(schoolId)}/consents`, accessToken);

export const fetchConsentPurposes = (apiUrl: string, accessToken: string) =>
  get<ConsentPurposes>(apiUrl, '/privacy/consent-purposes', accessToken);

// Tasks and projects (M6.7).

export const fetchMyTasks = (apiUrl: string, accessToken: string) =>
  get<MyTasks>(apiUrl, '/tasks', accessToken);

export const fetchProject = (apiUrl: string, accessToken: string, projectId: string) =>
  get<ProjectView>(apiUrl, `/projects/${encodeURIComponent(projectId)}`, accessToken);

// Notifications (M7.2, ADR 0031).

export const fetchMyNotifications = (apiUrl: string, accessToken: string) =>
  get<MyNotifications>(apiUrl, '/notifications', accessToken);

// Accounting export (M7.4).

export const fetchAccountingCompanies = (apiUrl: string, accessToken: string) =>
  get<AccountingCompanies>(apiUrl, '/accounting/companies', accessToken);

export const fetchAccountingSummary = (
  apiUrl: string,
  accessToken: string,
  period: { companyId: string; from: string; to: string },
) => get<AccountingSummary>(apiUrl, `/accounting/summary?${new URLSearchParams(period)}`, accessToken);

/** The ledger CSV, passed on as the API sends it. */
export const fetchLedgerCsv = (
  apiUrl: string,
  accessToken: string,
  period: { companyId: string; from: string; to: string },
) =>
  fetch(new URL(`/accounting/export?${new URLSearchParams(period)}`, apiUrl), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
