import { type MeResponse } from '@pythagoras/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, get, tokenFor } from './helpers';

// Each person's language (M9.1, ADR 0039): Hristo chooses Bulgarian for
// himself; Anna's stays as it was; anything but bg, en or null is refused.

const choose = async (token: string, language: unknown) => {
  const response = await fetch(`${API}/me/language`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ language }),
  });
  return { status: response.status, body: (await response.json()) as { language?: string | null } };
};

let hristo: string;
let anna: string;

beforeAll(async () => {
  [hristo, anna] = await Promise.all([tokenFor('hristo.georgiev'), tokenFor('anna.ivanova')]);
  await choose(hristo, null);
});

afterAll(async () => {
  await choose(hristo, null);
});

describe('language', () => {
  it('is nobody’s choice until they make it', async () => {
    expect((await get<MeResponse>('/me', hristo)).body.person.language).toBeNull();
  });

  it('is each person’s own', async () => {
    const before = (await get<MeResponse>('/me', anna)).body.person.language;
    expect(await choose(hristo, 'bg')).toEqual({ status: 200, body: { language: 'bg' } });
    expect((await get<MeResponse>('/me', hristo)).body.person.language).toBe('bg');
    expect((await get<MeResponse>('/me', anna)).body.person.language).toBe(before);
    expect((await choose(hristo, 'en')).body.language).toBe('en');
    expect((await get<MeResponse>('/me', hristo)).body.person.language).toBe('en');
  });

  it('accepts only the languages the platform speaks', async () => {
    expect((await choose(hristo, 'de')).status).toBe(400);
    expect((await choose(hristo, 'BG')).status).toBe(400);
    const unsigned = await fetch(`${API}/me/language`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'bg' }),
    });
    expect(unsigned.status).toBe(401);
  });
});
