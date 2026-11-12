import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type z } from 'zod';
import { type Principal } from '../auth/principal';
import { type Database, type PersonTransaction } from '../database/database';

// The shape shared by the school workspaces: validate a body, run the work as
// the person, and turn the database's refusals into answers a page can show.

export type RefusalStatus = 403 | 404 | 409 | 422;

export class Refused extends Error {
  constructor(
    readonly status: RefusalStatus,
    message: string,
  ) {
    super(message);
  }
}

export type Refusals = Record<string, [RefusalStatus, string]>;

const COMMON: Refusals = {
  '42501': [403, 'not permitted'],
  '23514': [422, 'a value is not allowed here'],
  P0002: [404, 'not found, or not yours to see'],
};

export function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BadRequestException(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid request',
    );
  }
  return parsed.data;
}

function answer(error: Refused): Error {
  if (error.status === 404) return new NotFoundException(error.message);
  if (error.status === 403) return new ForbiddenException(error.message);
  if (error.status === 409) return new ConflictException(error.message);
  return new UnprocessableEntityException(error.message);
}

/** Runs work as the person; a database code in `refusals` becomes that answer. */
export function runner(refusals: Refusals) {
  return async <T>(
    database: Database,
    principal: Principal,
    work: (tx: PersonTransaction) => Promise<T>,
  ): Promise<T> => {
    try {
      return await database.withPerson(principal, work);
    } catch (error) {
      if (error instanceof Refused) throw answer(error);
      const code = (error as { code?: unknown } | null)?.code;
      const refusal = typeof code === 'string' ? (refusals[code] ?? COMMON[code]) : undefined;
      if (refusal) throw answer(new Refused(refusal[0], refusal[1]));
      throw error;
    }
  };
}
