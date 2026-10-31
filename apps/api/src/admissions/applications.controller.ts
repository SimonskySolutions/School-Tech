import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  APPLICATION_NOTE_KINDS,
  type CreatedAccountResponse,
  type FamilyAdmissions,
  type SchoolApplications,
} from '@pythagoras/shared';
import { z } from 'zod';
import { ACCOUNT_DIRECTORY, type AccountDirectory, AccountExists } from '../accounts/keycloak-directory';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database } from '../database/database';
import {
  addApplicationNote,
  answerOffer,
  closeIntake,
  decideApplication,
  familyAdmissions,
  inviteApplicant,
  linkApplicantLogin,
  makeOffer,
  openIntake,
  reviewApplication,
  schoolApplications,
  submitApplication,
  withdrawApplication,
} from './applications.repository';
import { parse, run } from './inquiries.controller';
import { InquiriesRejected } from './inquiries.repository';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');
const name = z.string().trim().min(1).max(100);
const optional = (max: number) => z.string().trim().min(1).max(max).optional();

// For a known child only the child; for a new child the name and date of
// birth the grade needs (ADR 0027), and nothing more.
export const applicationSchema = z
  .strictObject({
    intakeId: z.uuid(),
    noticeId: z.uuid(),
    studentId: z.uuid().optional(),
    child: z.strictObject({ givenName: name, familyName: name, birthDate: day }).optional(),
    currentSchool: optional(200),
    message: optional(2000),
  })
  .refine((body) => (body.studentId === undefined) !== (body.child === undefined), {
    message: 'name either one of your children (studentId) or a new child (child)',
  });
export const intakeSchema = z
  .strictObject({
    schoolId: z.uuid(),
    schoolYear: z.string().regex(/^\d{4}\/\d{2}$/, 'a school year like 2027/28'),
    grade: z.string().trim().min(1).max(20),
    places: z.number().int().min(1).max(1000),
    opensOn: day,
    closesOn: day,
  })
  .refine((body) => body.closesOn >= body.opensOn, { message: 'an intake closes after it opens' });
export const inviteSchema = z.object({ givenName: name, familyName: name });
export const offerSchema = z.object({ answerBy: day });
export const decisionSchema = z.object({ decision: z.enum(['waitlisted', 'rejected']) });
export const answerSchema = z.object({ accept: z.boolean() });
export const applicationNoteSchema = z.object({
  kind: z.enum(APPLICATION_NOTE_KINDS),
  body: z.string().trim().min(1).max(4000),
});
const listSchema = z.object({ intakeId: z.uuid().optional() });

/** Intakes, applications and invitations to apply (M5.2, ADR 0027). */
@Controller('admissions')
export class AdmissionsController {
  private readonly logger = new Logger(AdmissionsController.name);

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ACCOUNT_DIRECTORY) private readonly directory: AccountDirectory | null,
  ) {}

  /** A signed-in parent: open intakes, their children, their own applications. */
  @Get('family')
  family(@CurrentPrincipal() principal: Principal): Promise<FamilyAdmissions> {
    return run(this.database, principal, (tx) => familyAdmissions(tx));
  }

  @Post('applications')
  @HttpCode(201)
  apply(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const data = parse(applicationSchema, body);
    return run(this.database, principal, (tx) => submitApplication(tx, data));
  }

  @Post('applications/:applicationId/withdraw')
  @HttpCode(200)
  withdraw(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
  ) {
    return run(this.database, principal, (tx) => withdrawApplication(tx, applicationId));
  }

  /** The parent who applied accepts or declines an offer. */
  @Post('applications/:applicationId/answer')
  @HttpCode(200)
  answer(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Body() body: unknown,
  ) {
    const { accept } = parse(answerSchema, body);
    return run(this.database, principal, (tx) => answerOffer(tx, applicationId, accept));
  }

  /** Admissions staff: intakes and applications at their schools. */
  @Get('applications')
  applications(
    @CurrentPrincipal() principal: Principal,
    @Query() query: unknown,
  ): Promise<SchoolApplications> {
    const { intakeId } = parse(listSchema, query);
    return run(this.database, principal, async (tx) => {
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission_anywhere('admissions.manage') AS ok`,
      );
      if (!allowed?.ok)
        throw new InquiriesRejected(403, 'applications are for the school’s admissions staff');
      return schoolApplications(tx, intakeId ?? null);
    });
  }

  @Post('applications/:applicationId/review')
  @HttpCode(200)
  review(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
  ) {
    return run(this.database, principal, (tx) => reviewApplication(tx, applicationId));
  }

  @Post('applications/:applicationId/offer')
  @HttpCode(200)
  offer(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Body() body: unknown,
  ) {
    const { answerBy } = parse(offerSchema, body);
    return run(this.database, principal, (tx) => makeOffer(tx, applicationId, answerBy));
  }

  @Post('applications/:applicationId/decision')
  @HttpCode(200)
  decide(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Body() body: unknown,
  ) {
    const { decision } = parse(decisionSchema, body);
    return run(this.database, principal, (tx) => decideApplication(tx, applicationId, decision));
  }

  @Post('applications/:applicationId/notes')
  @HttpCode(201)
  note(
    @CurrentPrincipal() principal: Principal,
    @Param('applicationId', new ParseUUIDPipe()) applicationId: string,
    @Body() body: unknown,
  ) {
    const data = parse(applicationNoteSchema, body);
    return run(this.database, principal, (tx) => addApplicationNote(tx, applicationId, data.kind, data.body));
  }

  @Post('intakes')
  @HttpCode(201)
  openIntake(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const data = parse(intakeSchema, body);
    return run(this.database, principal, (tx) => openIntake(tx, data));
  }

  @Post('intakes/:intakeId/close')
  @HttpCode(200)
  closeIntake(
    @CurrentPrincipal() principal: Principal,
    @Param('intakeId', new ParseUUIDPipe()) intakeId: string,
  ) {
    return run(this.database, principal, (tx) => closeIntake(tx, intakeId));
  }

  /**
   * Invites the sender of an inquiry to apply: a parent record and a sign-in
   * account, only for an address the group does not know (ADR 0027).
   */
  @Post('inquiries/:inquiryId/invite')
  @HttpCode(201)
  // The answer may carry a temporary password: never cache it anywhere.
  @Header('cache-control', 'no-store')
  async invite(
    @CurrentPrincipal() principal: Principal,
    @Param('inquiryId', new ParseUUIDPipe()) inquiryId: string,
    @Body() body: unknown,
  ): Promise<CreatedAccountResponse> {
    const data = parse(inviteSchema, body);
    const parent = await run(this.database, principal, (tx) => inviteApplicant(tx, inquiryId, data));
    if (parent.hasLogin)
      throw new ConflictException('the parent already has a sign-in account and can apply');
    if (!this.directory) throw new ServiceUnavailableException('account provisioning is not configured');

    let created;
    try {
      created = await this.directory.createAccount({
        email: parent.email,
        givenName: parent.givenName,
        familyName: parent.familyName,
      });
    } catch (error) {
      if (error instanceof AccountExists) throw new ConflictException(error.message);
      throw error;
    }
    try {
      await run(this.database, principal, (tx) => linkApplicantLogin(tx, parent.personId, created.subject));
    } catch (error) {
      // Never leave a Keycloak user that no person record knows about.
      await this.directory
        .deleteAccount(created.subject)
        .catch((cleanup: unknown) =>
          this.logger.error(
            `could not remove unlinked Keycloak user ${created.subject}: ${cleanup instanceof Error ? cleanup.message : 'unknown'}`,
          ),
        );
      throw error;
    }
    return {
      personId: parent.personId,
      username: parent.email,
      setup: created.temporaryPassword ? 'temporary_password' : 'email',
      temporaryPassword: created.temporaryPassword,
    };
  }
}
