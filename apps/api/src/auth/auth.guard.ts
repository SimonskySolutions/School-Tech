import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENV } from '../config/config.module';
import { type Env } from '../config/env';
import { Database } from '../database/database';
import { type AuthenticatedRequest, IS_PUBLIC } from './principal';
import { TokenRejected, TokenVerifier } from './token-verifier';

/**
 * Global guard: every route needs a verified token whose subject is linked to an
 * active person, unless the route is marked @Public(). Staff must also have
 * signed in with a second factor where that is required (M8.3, ADR 0034).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(Database) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('sign-in required');
    }

    let verified;
    try {
      verified = await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof TokenRejected) {
        this.logger.warn(`${error.message} (request ${request.requestId ?? '-'})`);
        throw new UnauthorizedException('invalid or expired sign-in');
      }
      throw error;
    }

    const personId = await this.database.resolveLogin('keycloak', verified.subject);
    if (!personId) {
      throw new ForbiddenException('this sign-in is not linked to a Pythagoras account');
    }
    if (
      this.env.STAFF_SECOND_FACTOR === 'required' &&
      verified.acr !== this.env.SECOND_FACTOR_ACR &&
      (await this.database.requiresSecondFactor(personId))
    ) {
      // The web app recognises this answer and signs the person in again with the second factor.
      throw new ForbiddenException({
        statusCode: 403,
        error: SECOND_FACTOR_REQUIRED,
        message: 'staff sign in with a second factor',
      });
    }
    request.principal = {
      personId,
      subject: verified.subject,
      clientId: verified.clientId,
      requestId: request.requestId ?? 'unknown',
    };
    return true;
  }
}

export const SECOND_FACTOR_REQUIRED = 'second_factor_required';

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9\-_.]+)$/.exec(header ?? '');
  return match?.[1] ?? null;
}
