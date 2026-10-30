import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Payload } from 'payload';

// The platform's service account in the CMS (ADR 0017): when an administrator
// adds a school's website in the platform, the API creates its tenant here
// with this account's API key. The role "platform" may add websites and
// nothing else. Runs in every environment; the key is a Docker secret.

export const PLATFORM_EMAIL = 'platform-service@pythagoras.invalid';

export async function ensurePlatformAccount(payload: Payload): Promise<void> {
  const file = process.env.CMS_PLATFORM_API_KEY_FILE;
  if (!file) {
    payload.logger.warn('CMS_PLATFORM_API_KEY_FILE not set: the platform cannot add websites here');
    return;
  }
  const apiKey = readFileSync(file, 'utf8').trim();
  const found = await payload.find({
    collection: 'users',
    where: { email: { equals: PLATFORM_EMAIL } },
    limit: 1,
  });
  const data = { role: 'platform', enableAPIKey: true, apiKey } as never;
  if (found.docs[0]) {
    // Keeps the key in step with the secret, so rotating the secret is a restart.
    await payload.update({ collection: 'users', id: found.docs[0].id, data });
    return;
  }
  await payload.create({
    collection: 'users',
    data: {
      email: PLATFORM_EMAIL,
      name: 'Pythagoras platform (service)',
      // Never used: the account signs in with its key only.
      password: randomBytes(32).toString('base64url'),
      ...(data as object),
    } as never,
  });
}
