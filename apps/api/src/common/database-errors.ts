import {
  ConflictException,
  ForbiddenException,
  type HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';

// Database refusals mapped to HTTP answers the client can act on (error codes
// in docs/data-model.md). Unknown errors are left alone and become 500s.

const MESSAGES: Record<string, () => HttpException> = {
  '42501': () => new ForbiddenException('not permitted'),
  PY002: () => new ConflictException('one of the chosen sessions is full'),
  PY007: () => new ConflictException('one of the chosen sessions is no longer open for booking'),
  PY008: () => new ConflictException('a price changed; please review the basket again'),
  PY012: () => new UnprocessableEntityException('a child is not eligible for one of the chosen services'),
  PY013: () => new ConflictException('the session has not started yet'),
  PY016: () => new ConflictException("a guardian's permission for the trip is needed first"),
  PY017: () => new ConflictException('a payment for this trip is still open'),
  PY019: () => new ConflictException('one of the chosen items is no longer in stock'),
  '23505': () => new ConflictException('already booked or already submitted'),
  '23503': () =>
    new UnprocessableEntityException('the request refers to something that does not belong together'),
};

export function asHttpError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && MESSAGES[code] ? MESSAGES[code]() : error;
}
