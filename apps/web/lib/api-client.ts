import { type MeResponse, type SchoolSummary } from '@pythagoras/shared';

// Server-side calls from the web app to the API, with the signed-in person's
// access token. The token is attached here and never sent to the browser.

export type ApiResult<T> = { kind: 'ok'; value: T } | { kind: 'signed-out' } | { kind: 'unlinked' };

async function get<T>(apiUrl: string, path: string, accessToken: string): Promise<ApiResult<T>> {
  const response = await fetch(new URL(path, apiUrl), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (response.status === 401) return { kind: 'signed-out' };
  if (response.status === 403) return { kind: 'unlinked' };
  if (!response.ok) throw new Error(`API ${path} answered ${response.status}`);
  return { kind: 'ok', value: (await response.json()) as T };
}

export const fetchMe = (apiUrl: string, accessToken: string) => get<MeResponse>(apiUrl, '/me', accessToken);

export const fetchSchools = (apiUrl: string, accessToken: string) =>
  get<SchoolSummary[]>(apiUrl, '/schools', accessToken);
