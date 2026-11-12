import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { type Request } from 'express';
import { type PersonId } from '@pythagoras/shared';
import { type RequestContext } from '../database/database';

/** The signed-in person behind a request. Set by AuthGuard; never taken from the client. */
export interface Principal extends RequestContext {
  readonly personId: PersonId;
  readonly subject: string;
  readonly clientId: string;
}

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
  requestId?: string;
}

export const IS_PUBLIC = 'pythagoras:public';

/** Marks a route that needs no signed-in person (health checks, later webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) {
      // Only reachable if a route is wrongly marked public and still asks for a person.
      throw new Error('no principal on request: route is public or the guard did not run');
    }
    return request.principal;
  },
);
