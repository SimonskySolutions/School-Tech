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
import { Database } from '../database/database';
import { type AuthenticatedRequest, IS_PUBLIC } from './principal';
import { TokenRejected, TokenVerifier } from './token-verifier';

/**
 * Global guard: every route needs a verified token whose subject is linked to an
 * active person, unless the route is marked @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(Database) private readonly database: Database,
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
    request.principal = {
      personId,
      subject: verified.subject,
      clientId: verified.clientId,
      requestId: request.requestId ?? 'unknown',
    };
    return true;
  }
}

function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9\-_.]+)$/.exec(header ?? '');
  return match?.[1] ?? null;
}
