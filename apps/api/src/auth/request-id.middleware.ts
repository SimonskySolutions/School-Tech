import { randomUUID } from 'node:crypto';
import { type NextFunction, type Response } from 'express';
import { type AuthenticatedRequest } from './principal';

const SAFE_ID = /^[A-Za-z0-9\-_.]{8,64}$/;

/** Gives every request an id (kept from the gateway when well-formed), echoed in the response. */
export function requestId(request: AuthenticatedRequest, response: Response, next: NextFunction): void {
  const incoming = request.header('x-request-id');
  request.requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
