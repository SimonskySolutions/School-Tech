import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';

// Verifies Keycloak access tokens (ADR 0013). Anything that is not a currently
// valid access token for this API, issued by our realm to an allowed client, is
// rejected with a reason that is safe to log (never the token itself).

export interface VerifiedToken {
  readonly subject: string;
  readonly clientId: string;
  readonly expiresAt: Date;
}

export class TokenRejected extends Error {
  constructor(readonly reason: string) {
    super(`token rejected: ${reason}`);
  }
}

export interface TokenVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly allowedClients: readonly string[];
  readonly keys: JWTVerifyGetKey;
}

export class TokenVerifier {
  constructor(private readonly options: TokenVerifierOptions) {}

  async verify(token: string): Promise<VerifiedToken> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.options.keys, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['RS256'],
        clockTolerance: 5,
        requiredClaims: ['sub', 'exp', 'iat', 'azp', 'typ'],
      }));
    } catch (error) {
      throw new TokenRejected(describe(error));
    }

    if (payload.typ !== 'Bearer') {
      throw new TokenRejected('not an access token');
    }
    if (typeof payload.azp !== 'string' || !this.options.allowedClients.includes(payload.azp)) {
      throw new TokenRejected('issued to a client that may not call the API');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.exp === undefined) {
      throw new TokenRejected('missing subject or expiry');
    }
    return { subject: payload.sub, clientId: payload.azp, expiresAt: new Date(payload.exp * 1000) };
  }
}

function describe(error: unknown): string {
  if (error instanceof errors.JWTExpired) return 'expired';
  if (error instanceof errors.JWTClaimValidationFailed) return `claim "${error.claim}" ${error.reason}`;
  if (error instanceof errors.JWSSignatureVerificationFailed) return 'bad signature';
  if (error instanceof errors.JOSEAlgNotAllowed) return 'algorithm not allowed';
  if (error instanceof errors.JWKSNoMatchingKey) return 'unknown signing key';
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) return 'malformed token';
  if (error instanceof errors.JOSEError) return error.code;
  return 'verification failed';
}
