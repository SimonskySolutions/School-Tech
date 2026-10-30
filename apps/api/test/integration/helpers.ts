import { readFileSync } from 'node:fs';
import { type CheckoutGroupView, type CheckoutResponse, type StudentOfferings } from '@pythagoras/shared';

// Shared by integration tests that buy through the real API and the
// development payment provider.

export const API = process.env.API_URL ?? 'http://api:3000';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://keycloak:8080';
export const secret = (name: string) => readFileSync(`/workspace/secrets/${name}`, 'utf8').trim();

export const MILA = 'c1000000-0000-7000-8000-000000000030';
export const BORIS = 'c1000000-0000-7000-8000-000000000031';

export async function tokenFor(user: string): Promise<string> {
  const response = await fetch(`${KEYCLOAK}/realms/pythagoras/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'pythagoras-dev-tests',
      username: `${user}@pythagoras.test`,
      password: secret('keycloak_dev_user_password'),
    }),
  });
  if (!response.ok) throw new Error(`token for ${user}: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function get<T>(path: string, token: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: (await response.json()) as T };
}

export async function offeringsOf(token: string, studentId: string) {
  const { body } = await get<StudentOfferings>(`/students/${studentId}/offerings`, token);
  const find = (kind: 'lunch' | 'activity') => body.offerings.find((offering) => offering.kind === kind)!;
  return { lunch: find('lunch'), activity: find('activity') };
}

export async function placeOrder(token: string, items: unknown[]): Promise<CheckoutResponse> {
  const response = await fetch(`${API}/checkout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({ items }),
  });
  if (response.status !== 201) throw new Error(`checkout answered ${response.status}`);
  return (await response.json()) as CheckoutResponse;
}

/** Pays on the development provider's page and waits until the worker has confirmed. */
export async function payAndWait(token: string, placed: CheckoutResponse): Promise<void> {
  const checkoutToken = placed.orders[0]!.checkoutUrl!.split('/dev-payments/checkout/')[1]!;
  await fetch(`${API}/dev-payments/checkout/${checkoutToken}/succeed`, {
    method: 'POST',
    redirect: 'manual',
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    const { body } = await get<CheckoutGroupView>(`/checkout-groups/${placed.checkoutGroupId}`, token);
    if (body.orders.every((order) => order.status === 'paid')) return;
    if (Date.now() > deadline) throw new Error('payment was not confirmed');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://keycloak:8080';

/** Stands in for a new person completing first sign-in: sets their own password, then signs in. */
export async function finishFirstSignIn(username: string, password: string): Promise<string> {
  const admin = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: secret('keycloak_admin_password'),
    }),
  });
  const { access_token: adminToken } = (await admin.json()) as { access_token: string };
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${KEYCLOAK_URL}/admin/realms/pythagoras${path}`, {
      ...init,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    });
  const [user] = (await (
    await call(`/users?username=${encodeURIComponent(username)}&exact=true`)
  ).json()) as {
    id: string;
  }[];
  await call(`/users/${user!.id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [] }) });
  await call(`/users/${user!.id}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: password, temporary: false }),
  });
  const signedIn = await fetch(`${KEYCLOAK_URL}/realms/pythagoras/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'pythagoras-dev-tests',
      username,
      password,
    }),
  });
  if (!signedIn.ok) throw new Error(`first sign-in for ${username}: ${signedIn.status}`);
  return ((await signedIn.json()) as { access_token: string }).access_token;
}

export async function post<T>(token: string, path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T & { message?: string } };
}
