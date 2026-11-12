import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  INQUIRY_NOTE_KINDS,
  INQUIRY_OUTCOMES,
  type InquiryForm,
  type SchoolInquiries,
} from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, Public, type Principal } from '../auth/principal';
import { Database, type PersonTransaction } from '../database/database';
import {
  addNote,
  closeInquiry,
  eraseInquiry,
  exportInquiry,
  formFromRows,
  InquiriesRejected,
  refusalsAsInquiries,
  schoolInquiries,
  withdrawNewsConsent,
} from './inquiries.repository';

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
const host = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/:\d+$/, ''))
  .pipe(z.string().regex(HOSTNAME));
const optional = (max: number) => z.string().trim().min(1).max(max).optional();

// The fields ADR 0026 allows, and nothing else (strict): no date of birth,
// address or health data.
export const inquirySchema = z.strictObject({
  host,
  schoolId: z.uuid(),
  noticeId: z.uuid(),
  parentName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{6,20}$/)
    .optional(),
  childName: optional(100),
  birthYear: z.number().int().min(2000).max(2100).optional(),
  gradeOfInterest: optional(20),
  intendedStart: optional(40),
  message: optional(2000),
  newsConsent: z.boolean(),
});
export const noteSchema = z.object({
  kind: z.enum(INQUIRY_NOTE_KINDS),
  body: z.string().trim().min(1).max(2000),
});
export const closeSchema = z.object({ outcome: z.enum(INQUIRY_OUTCOMES) });
const filterSchema = z.object({ status: z.enum(['open', 'closed', 'all']).default('open') });

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

export function asHttp(error: unknown): never {
  if (!(error instanceof InquiriesRejected)) throw error;
  if (error.status === 404) throw new NotFoundException(error.message);
  if (error.status === 403) throw new ForbiddenException(error.message);
  if (error.status === 409) throw new ConflictException(error.message);
  if (error.status === 429) throw new HttpException(error.message, 429);
  throw new UnprocessableEntityException(error.message);
}

/**
 * The inquiry form on school websites (M5.1). Public: websites have no
 * sign-in. Nothing about the sender is kept but what the form says (ADR 0026).
 */
@Public()
@Controller('sites')
export class PublicInquiriesController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get('inquiry-form')
  async form(@Query('host') value: unknown): Promise<InquiryForm> {
    const hostname = parse(host, value);
    const form = formFromRows(await this.database.inquiryForm(hostname));
    if (!form) throw new NotFoundException('no inquiry form on this host');
    return form;
  }

  @Post('inquiries')
  @HttpCode(202)
  async send(@Body() body: unknown): Promise<{ received: true }> {
    const data = parse(inquirySchema, body);
    try {
      await refusalsAsInquiries(
        () =>
          this.database.submitInquiry([
            data.host,
            data.schoolId,
            data.noticeId,
            data.parentName,
            data.email,
            data.phone ?? null,
            data.childName ?? null,
            data.birthYear ?? null,
            data.gradeOfInterest ?? null,
            data.intendedStart ?? null,
            data.message ?? null,
            data.newsConsent,
          ]),
        'no such school on this website',
      );
    } catch (error) {
      asHttp(error);
    }
    // The same answer whether the inquiry is new or added to an open one.
    return { received: true };
  }
}

export async function run<T>(
  database: Database,
  principal: Principal,
  work: (tx: PersonTransaction) => Promise<T>,
) {
  try {
    return await refusalsAsInquiries(() => database.withPerson(principal, work));
  } catch (error) {
    return asHttp(error);
  }
}

/** Inquiries at the schools where the viewer works on admissions (M5.1). */
@Controller('admissions/inquiries')
export class InquiriesController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(@CurrentPrincipal() principal: Principal, @Query() query: unknown): Promise<SchoolInquiries> {
    const { status } = parse(filterSchema, query);
    return run(this.database, principal, async (tx) => {
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission_anywhere('admissions.manage') AS ok`,
      );
      if (!allowed?.ok) throw new InquiriesRejected(403, 'inquiries are for the school’s admissions staff');
      return schoolInquiries(tx, status);
    });
  }

  @Post(':inquiryId/notes')
  @HttpCode(201)
  note(
    @CurrentPrincipal() principal: Principal,
    @Param('inquiryId', new ParseUUIDPipe()) inquiryId: string,
    @Body() body: unknown,
  ) {
    const data = parse(noteSchema, body);
    return run(this.database, principal, (tx) => addNote(tx, inquiryId, data.kind, data.body));
  }

  @Post(':inquiryId/close')
  @HttpCode(200)
  close(
    @CurrentPrincipal() principal: Principal,
    @Param('inquiryId', new ParseUUIDPipe()) inquiryId: string,
    @Body() body: unknown,
  ) {
    const data = parse(closeSchema, body);
    return run(this.database, principal, (tx) => closeInquiry(tx, inquiryId, data.outcome));
  }

  /** The family asked to be forgotten (Art. 17). */
  @Post(':inquiryId/erase')
  @HttpCode(200)
  erase(
    @CurrentPrincipal() principal: Principal,
    @Param('inquiryId', new ParseUUIDPipe()) inquiryId: string,
  ) {
    return run(this.database, principal, (tx) => eraseInquiry(tx, inquiryId));
  }

  /** The family no longer wants news about open days (Art. 7(3)). */
  @Post(':inquiryId/withdraw-consent')
  @HttpCode(200)
  withdrawConsent(
    @CurrentPrincipal() principal: Principal,
    @Param('inquiryId', new ParseUUIDPipe()) inquiryId: string,
  ) {
    return run(this.database, principal, (tx) => withdrawNewsConsent(tx, inquiryId));
  }

  /** What is held about the sender, for an access request (Art. 15). */
  @Post(':inquiryId/export')
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  export(
    @CurrentPrincipal() principal: Principal,
    @Param('inquiryId', new ParseUUIDPipe()) inquiryId: string,
  ) {
    return run(this.database, principal, (tx) => exportInquiry(tx, inquiryId));
  }
}
