import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMe } from './api-client';

const answer = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('API results', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads a 403 asking for the second factor as signed out, to sign in again with it (M8.3)', async () => {
    answer(403, {
      statusCode: 403,
      error: 'second_factor_required',
      message: 'staff sign in with a second factor',
    });
    expect(await fetchMe('http://api:3000', 'token')).toEqual({ kind: 'signed-out', secondFactor: true });
  });

  it('reads any other 403 as a sign-in without a Pythagoras account', async () => {
    answer(403, { statusCode: 403, message: 'this sign-in is not linked to a Pythagoras account' });
    expect(await fetchMe('http://api:3000', 'token')).toEqual({ kind: 'unlinked' });
  });

  it('reads a 401 as signed out', async () => {
    answer(401, { statusCode: 401 });
    expect(await fetchMe('http://api:3000', 'token')).toEqual({ kind: 'signed-out' });
  });
});
