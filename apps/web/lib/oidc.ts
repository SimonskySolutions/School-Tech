import * as client from 'openid-client';
import { type WebConfig } from './config';
import { type Session, type SignInTransaction } from './session';

// OpenID Connect against Keycloak (ADR 0014). Browser-facing endpoints use the
// public issuer; token, key and logout calls go to the internal service URL.

export function oidcConfiguration(config: WebConfig): client.Configuration {
  const metadata: client.ServerMetadata = {
    issuer: config.OIDC_ISSUER,
    authorization_endpoint: `${config.OIDC_ISSUER}/protocol/openid-connect/auth`,
    token_endpoint: `${config.OIDC_INTERNAL_URL}/protocol/openid-connect/token`,
    jwks_uri: `${config.OIDC_INTERNAL_URL}/protocol/openid-connect/certs`,
    end_session_endpoint: `${config.OIDC_ISSUER}/protocol/openid-connect/logout`,
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
  };
  const configuration = new client.Configuration(metadata, config.OIDC_CLIENT_ID, config.OIDC_CLIENT_SECRET);
  if (config.NODE_ENV !== 'production') {
    // Development runs over plain HTTP inside Docker; production refuses this.
    client.allowInsecureRequests(configuration);
  }
  return configuration;
}

export function callbackUrl(config: WebConfig): string {
  return new URL('/auth/callback', config.APP_URL).toString();
}

export async function beginSignIn(
  configuration: client.Configuration,
  config: WebConfig,
  returnTo: string,
): Promise<{ url: URL; transaction: SignInTransaction }> {
  const codeVerifier = client.randomPKCECodeVerifier();
  const transaction: SignInTransaction = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    codeVerifier,
    returnTo,
  };
  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: callbackUrl(config),
    scope: 'openid',
    response_type: 'code',
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state: transaction.state,
    nonce: transaction.nonce,
  });
  return { url, transaction };
}

type TokenResponse = client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;

function toSession(tokens: TokenResponse, subject: string, now: number): Session {
  const refreshExpiresIn = Number((tokens as unknown as { refresh_expires_in?: unknown }).refresh_expires_in);
  if (!tokens.refresh_token || !Number.isFinite(refreshExpiresIn) || refreshExpiresIn <= 0) {
    throw new Error('identity provider returned no refresh token');
  }
  const nowSeconds = Math.floor(now / 1000);
  return {
    subject,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessExpiresAt: nowSeconds + (tokens.expires_in ?? 60),
    refreshExpiresAt: nowSeconds + refreshExpiresIn,
  };
}

/** Exchanges the code, checking state, PKCE and the ID token's nonce, issuer, audience and signature. */
export async function completeSignIn(
  configuration: client.Configuration,
  currentUrl: URL,
  transaction: SignInTransaction,
  now = Date.now(),
): Promise<Session> {
  const tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const subject = tokens.claims()?.sub;
  if (!subject) throw new Error('ID token has no subject');
  return toSession(tokens, subject, now);
}

export async function refreshSession(
  configuration: client.Configuration,
  session: Session,
  now = Date.now(),
): Promise<Session> {
  const tokens = await client.refreshTokenGrant(configuration, session.refreshToken);
  return toSession(tokens, session.subject, now);
}

/** Ends the Keycloak session through the back channel, so the refresh token stops working. */
export async function endIdentitySession(config: WebConfig, refreshToken: string): Promise<boolean> {
  const response = await fetch(`${config.OIDC_INTERNAL_URL}/protocol/openid-connect/logout`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.OIDC_CLIENT_ID,
      client_secret: config.OIDC_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  return response.ok;
}
