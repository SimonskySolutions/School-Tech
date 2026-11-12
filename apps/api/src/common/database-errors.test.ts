import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { asHttpError } from './database-errors';

describe('asHttpError', () => {
  it('turns database refusals into answers the portal can act on', () => {
    expect(asHttpError({ code: '42501' })).toBeInstanceOf(ForbiddenException);
    expect(asHttpError({ code: 'PY002' })).toBeInstanceOf(ConflictException);
    expect(asHttpError({ code: 'PY007' })).toBeInstanceOf(ConflictException);
    expect(asHttpError({ code: 'PY008' })).toBeInstanceOf(ConflictException);
    expect(asHttpError({ code: '23505' })).toBeInstanceOf(ConflictException);
    expect(asHttpError({ code: '23503' })).toBeInstanceOf(UnprocessableEntityException);
  });

  it('leaves anything else alone, so it is logged as a server error', () => {
    const unexpected = new Error('connection reset');
    expect(asHttpError(unexpected)).toBe(unexpected);
    expect(asHttpError({ code: 'XX000' })).toEqual({ code: 'XX000' });
    expect(asHttpError(null)).toBeNull();
  });
});
