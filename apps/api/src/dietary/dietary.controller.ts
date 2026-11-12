import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ALLERGEN_CODES,
  DIETARY_KINDS,
  DIETARY_SEVERITIES,
  type DietaryNeed,
  type DietaryNeedRequest,
  type DietaryReview,
  type StudentDietary,
} from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { asHttpError } from '../common/database-errors';
import { Database, type PersonTransaction } from '../database/database';
import {
  addNeed,
  changeNeed,
  DietaryRejected,
  dietaryReview,
  endNeed,
  studentDietary,
  verifyNeed,
  withdrawNeed,
} from './dietary.repository';

export const needSchema: z.ZodType<DietaryNeedRequest> = z.object({
  kind: z.enum(DIETARY_KINDS),
  description: z.string().trim().min(1).max(500),
  severity: z.enum(DIETARY_SEVERITIES).nullable().optional(),
  allergens: z
    .array(z.enum(ALLERGEN_CODES as [string, ...string[]]))
    .max(ALLERGEN_CODES.length)
    .transform((codes) => [...new Set(codes)]),
}) as z.ZodType<DietaryNeedRequest>;

function parseNeed(body: unknown): DietaryNeedRequest {
  const parsed = needSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BadRequestException(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid request',
    );
  }
  return parsed.data;
}

async function run<T>(
  database: Database,
  principal: Principal,
  work: (tx: PersonTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await database.withPerson(principal, work);
  } catch (error) {
    if (error instanceof DietaryRejected) {
      if (error.status === 404) throw new NotFoundException(error.message);
      if (error.status === 403) throw new ForbiddenException(error.message);
      throw new ConflictException(error.message);
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === '23514') throw new UnprocessableEntityException('a value is not allowed here');
    throw asHttpError(error);
  }
}

/** A guardian records and changes their child's dietary and health needs (M4.1). */
@Controller('students/:studentId/dietary')
export class DietaryController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentDietary> {
    return run(this.database, principal, async (tx) => {
      const found = await studentDietary(tx, studentId);
      if (!found) throw new DietaryRejected(404, 'no such child, or not yours to see');
      return found;
    });
  }

  @Post()
  @HttpCode(201)
  add(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() body: unknown,
  ): Promise<DietaryNeed> {
    const need = parseNeed(body);
    return run(this.database, principal, (tx) => addNeed(tx, studentId, need));
  }

  @Patch(':needId')
  change(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('needId', new ParseUUIDPipe()) needId: string,
    @Body() body: unknown,
  ): Promise<DietaryNeed> {
    const need = parseNeed(body);
    return run(this.database, principal, (tx) => changeNeed(tx, studentId, needId, need));
  }

  @Post(':needId/end')
  @HttpCode(200)
  end(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('needId', new ParseUUIDPipe()) needId: string,
  ): Promise<DietaryNeed> {
    return run(this.database, principal, (tx) => endNeed(tx, studentId, needId));
  }

  @Delete(':needId')
  @HttpCode(204)
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Param('needId', new ParseUUIDPipe()) needId: string,
  ): Promise<void> {
    return run(this.database, principal, (tx) => withdrawNeed(tx, studentId, needId));
  }
}

/** School Life reviews and verifies the needs at its schools (M4.1). */
@Controller('school-life/dietary')
export class DietaryReviewController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  review(@CurrentPrincipal() principal: Principal): Promise<DietaryReview> {
    return run(this.database, principal, async (tx) => {
      // The review lists children by enrolment; the kitchen, which sees no
      // enrolments, gets the same needs on its kitchen list instead.
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission_anywhere('sensitive.dietary.read')
                AND access.has_permission_anywhere('enrolment.read') AS ok`,
      );
      if (!allowed?.ok)
        throw new DietaryRejected(403, 'the dietary review is for School Life and school leaders');
      return dietaryReview(tx);
    });
  }

  @Post(':needId/verify')
  @HttpCode(200)
  verify(
    @CurrentPrincipal() principal: Principal,
    @Param('needId', new ParseUUIDPipe()) needId: string,
  ): Promise<DietaryNeed> {
    return run(this.database, principal, (tx) => verifyNeed(tx, needId));
  }
}
