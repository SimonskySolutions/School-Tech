import {
  type ActivityRegisters,
  type CheckoutGroupView,
  type CheckoutRequestBody,
  type CheckoutResponse,
  type KitchenCounts,
  type RevenueReport,
  type MeResponse,
  type SchoolSummary,
  type StudentOfferings,
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
