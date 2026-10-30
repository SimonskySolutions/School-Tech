import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EncryptJWT, jwtDecrypt } from 'jose';
import * as client from 'openid-client';
import { getFieldsToSign, jwtSign, type Payload } from 'payload';
import { type EditorIdentity } from './editor';

// Keycloak sign-in for website editors (ADR 0019), the same OpenID Connect
// flow as the portal (ADR 0014): authorization code with PKCE, state and
// nonce kept in a short-lived encrypted cookie, browser-facing endpoints on
// the public issuer, token and keys on the internal service address.

export const TRANSACTION_COOKIE = 'cms_sso_tx';
const TRANSACTION_SECONDS = 10 * 60;

function setting(name: string, fallback?: string): string {
  const file = process.env[`${name}_FILE`];
  const value = process.env[name] ?? (file ? readFileSync(file, 'utf8').trim() : fallback);
  if (!value) throw new Error(`${name} (or ${name}_FILE) is required for editor sign-in`);
  return value;
}

export function ssoSettings() {
  const publicUrl = setting('CMS_PUBLIC_URL');
  return {
    publicUrl,
    issuer: setting('OIDC_ISSUER', 'http://localhost:58080/realms/pythagoras'),
    internalUrl: setting('OIDC_INTERNAL_URL', 'http://keycloak:8080/realms/pythagoras'),
    clientId: setting('OIDC_CLIENT_ID', 'pythagoras-cms'),
    clientSecret: setting('OIDC_CLIENT_SECRET'),
    callbackUrl: new URL('/sso/callback', publicUrl).toString(),
    secure: publicUrl.startsWith('https://'),
  };
}

type Settings = ReturnType<typeof ssoSettings>;

export function oidc(settings: Settings): client.Configuration {
  const configuration = new client.Configuration(
    {
      issuer: settings.issuer,
      authorization_endpoint: `${settings.issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${settings.internalUrl}/protocol/openid-connect/token`,
      jwks_uri: `${settings.internalUrl}/protocol/openid-connect/certs`,
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    },
    settings.clientId,
    settings.clientSecret,
  );
  // Development runs over plain HTTP inside Docker; production uses HTTPS.
  if (!settings.secure) client.allowInsecureRequests(configuration);
  return configuration;
}

/** The transaction cookie's key, derived from Payload's secret for this one purpose. */
const transactionKey = (payloadSecret: string) =>
  createHash('sha256').update(`cms-sso-transaction:${payloadSecret}`).digest();

interface Transaction {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export async function beginSignIn(
  settings: Settings,
  payloadSecret: string,
): Promise<{ url: URL; cookie: string }> {
  const transaction: Transaction = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier: client.randomPKCECodeVerifier(),
  };
  const url = client.buildAuthorizationUrl(oidc(settings), {
    redirect_uri: settings.callbackUrl,
    scope: 'openid email profile',
    response_type: 'code',
    code_challenge: await client.calculatePKCECodeChallenge(transaction.codeVerifier),
    code_challenge_method: 'S256',
    state: transaction.state,
    nonce: transaction.nonce,
  });
  const cookie = await new EncryptJWT({ ...transaction })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${TRANSACTION_SECONDS}s`)
    .encrypt(transactionKey(payloadSecret));
  return { url, cookie };
}

/** Exchanges the code; checks state, PKCE, nonce, issuer, audience and signature. Returns the ID token's claims. */
export async function completeSignIn(
  settings: Settings,
  payloadSecret: string,
  currentUrl: URL,
  sealed: string | undefined,
): Promise<Record<string, unknown>> {
  if (!sealed) throw new Error('the sign-in took too long or started elsewhere');
  const { payload } = await jwtDecrypt(sealed, transactionKey(payloadSecret));
  const transaction = payload as unknown as Transaction;
  const tokens = await client.authorizationCodeGrant(oidc(settings), currentUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error('no ID token');
  return claims as Record<string, unknown>;
}

interface StoredUser {
  id: number | string;
  email: string;
  role?: string;
  keycloakSubject?: string | null;
  sessions?: { id: string; createdAt: Date | string; expiresAt: Date | string }[];
  [key: string]: unknown;
}

/**
 * Finds (by Keycloak subject, then e-mail) or creates the editor, sets their
 * role from Keycloak, records a session and signs Payload's own token, so the
 * admin, API and sign-out work as for any Payload sign-in.
 */
export async function signInEditor(
  payload: Payload,
  editor: EditorIdentity,
): Promise<{ token: string; exp: number; cookieName: string }> {
  const users = payload.collections.users?.config;
  if (!users) throw new Error('the CMS has no users collection');
  const bySubject = await payload.find({
    collection: 'users',
    where: { keycloakSubject: { equals: editor.subject } },
    limit: 1,
    overrideAccess: true,
  });
  const byEmail = bySubject.docs[0]
    ? bySubject
    : await payload.find({
        collection: 'users',
        where: { email: { equals: editor.email } },
        limit: 1,
        overrideAccess: true,
      });
  const existing = byEmail.docs[0] as StoredUser | undefined;
  if (existing?.role === 'platform')
    throw new Error('the platform service account cannot sign in as a person');
  if (existing?.keycloakSubject && existing.keycloakSubject !== editor.subject) {
    throw new Error('this e-mail address belongs to another Keycloak account');
  }

  const data = { name: editor.name, role: editor.role, keycloakSubject: editor.subject } as never;
  const user = (existing
    ? await payload.update({ collection: 'users', id: existing.id, data, overrideAccess: true })
    : await payload.create({
        collection: 'users',
        // Never used: people sign in through Keycloak.
        data: {
          ...(data as object),
          email: editor.email,
          password: randomBytes(32).toString('base64url'),
        } as never,
        overrideAccess: true,
      })) as unknown as StoredUser;

  // A session, as Payload's own sign-in records one, so signing out ends it.
  const raw = (await payload.db.findOne({
    collection: 'users',
    where: { id: { equals: user.id } },
  })) as StoredUser;
  const now = new Date();
  const sid = randomUUID();
  const sessions = [
    ...(raw.sessions ?? []).filter((session) => new Date(session.expiresAt) > now),
    { id: sid, createdAt: now, expiresAt: new Date(now.getTime() + users.auth.tokenExpiration * 1000) },
  ];
  await payload.db.updateOne({ collection: 'users', id: user.id, data: { sessions }, returning: false });

  const fieldsToSign = getFieldsToSign({
    collectionConfig: users,
    email: editor.email,
    sid,
    user: { ...user, collection: 'users' } as never,
  });
  const { token, exp } = await jwtSign({
    fieldsToSign,
    secret: payload.secret,
    tokenExpiration: users.auth.tokenExpiration,
  });
  return { token, exp, cookieName: `${payload.config.cookiePrefix}-token` };
}
