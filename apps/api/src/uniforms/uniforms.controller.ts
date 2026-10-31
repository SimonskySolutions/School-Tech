import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type SchoolUniforms } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import {
  addVariant,
  adjustStock,
  handOver,
  refusalsAsUniforms,
  schoolUniforms,
  UniformsRejected,
} from './uniforms.repository';

export const variantSchema = z.object({
  offeringId: z.uuid(),
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, 'letters, digits, dots, dashes'),
  size: z.string().trim().min(1).max(40).optional(),
  colour: z.string().trim().min(1).max(40).optional(),
  unitAmountMinor: z.number().int().min(0).max(10_000_000),
  lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
});
export const stockSchema = z
  .object({
    kind: z.enum(['delivery', 'correction']),
    delta: z
      .number()
      .int()
      .min(-10_000)
      .max(10_000)
      .refine((delta) => delta !== 0, 'cannot be 0'),
    reason: z.string().trim().min(1).max(300),
  })
  .refine((change) => change.kind !== 'delivery' || change.delta > 0, { message: 'a delivery adds items' });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BadRequestException(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'invalid request',
    );
  }
  return parsed.data;
}

async function run<T>(database: Database, principal: Principal, work: (tx: PersonTransaction) => Promise<T>) {
  try {
    return await refusalsAsUniforms(() => database.withPerson(principal, work));
  } catch (error) {
    if (!(error instanceof UniformsRejected)) throw error;
    if (error.status === 404) throw new NotFoundException(error.message);
    if (error.status === 403) throw new ForbiddenException(error.message);
    if (error.status === 409) throw new ConflictException(error.message);
    throw new UnprocessableEntityException(error.message);
  }
}

/** A school's uniforms: variants, stock and hand-overs (M4.6). */
@Controller('schools/:schoolId')
export class SchoolUniformsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('uniforms')
  overview(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ): Promise<SchoolUniforms> {
    return run(this.database, principal, async (tx) => {
      const found = await schoolUniforms(tx, schoolId);
      if (!found) throw new UniformsRejected(404, 'no such school, or not yours to see');
      return found;
    });
  }

  @Post('uniform-variants')
  @HttpCode(201)
  variant(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Body() body: unknown,
  ) {
    const data = parse(variantSchema, body);
    return run(this.database, principal, (tx) => addVariant(tx, schoolId, data));
  }

  @Post('uniform-variants/:variantId/stock')
  @HttpCode(200)
  stock(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('variantId', new ParseUUIDPipe()) variantId: string,
    @Body() body: unknown,
  ) {
    const data = parse(stockSchema, body);
    return run(this.database, principal, (tx) => adjustStock(tx, schoolId, variantId, data));
  }

  @Post('uniform-handovers/:reservationId')
  @HttpCode(200)
  handOver(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
  ) {
    return run(this.database, principal, (tx) => handOver(tx, schoolId, reservationId));
  }
}
