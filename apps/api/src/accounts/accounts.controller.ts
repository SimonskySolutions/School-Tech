import {
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type CreatedAccountResponse } from '@pythagoras/shared';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database } from '../database/database';
import { ACCOUNT_DIRECTORY, type AccountDirectory, AccountExists } from './keycloak-directory';

interface PersonRow {
  id: string;
  given_name: string;
  family_name: string;
  email: string | null;
  linked: boolean;
}

/**
 * Creates the sign-in account for a registered person (M3.2). Group
 * administrators only: linking a login to a person needs access.manage for
 * the whole group (row-level security on people.login_identity).
 */
@Controller('admin/people')
export class AccountsController {
  private readonly logger = new Logger(AccountsController.name);

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(ACCOUNT_DIRECTORY) private readonly directory: AccountDirectory | null,
  ) {}

  @Post(':personId/account')
  @HttpCode(201)
  // The answer may carry a temporary password: never cache it anywhere.
  @Header('cache-control', 'no-store')
  async create(
    @CurrentPrincipal() principal: Principal,
    @Param('personId', new ParseUUIDPipe()) personId: string,
  ): Promise<CreatedAccountResponse> {
    const person = await this.database.withPerson(principal, async (tx) => {
      const [allowed] = await tx.query<{ ok: boolean }>(
        `SELECT access.has_permission('access.manage') AS ok`,
      );
      if (!allowed?.ok) throw new ForbiddenException('creating sign-in accounts is for group administrators');
      const [row] = await tx.query<PersonRow>(
        `SELECT p.id, p.given_name, p.family_name, p.email,
                EXISTS (SELECT 1 FROM people.login_identity li
                         WHERE li.person_id = p.id AND li.disabled_at IS NULL) AS linked
           FROM people.person p WHERE p.id = $1`,
        [personId],
      );
      return row;
    });
    if (!person) throw new NotFoundException('no such person');
    if (!person.email) throw new UnprocessableEntityException('the person needs an e-mail address first');
    if (person.linked) throw new ConflictException('this person already has a sign-in account');
    if (!this.directory) throw new ServiceUnavailableException('account provisioning is not configured');

    let created;
    try {
      created = await this.directory.createAccount({
        email: person.email,
        givenName: person.given_name,
        familyName: person.family_name,
      });
    } catch (error) {
      if (error instanceof AccountExists) throw new ConflictException(error.message);
      throw error;
    }

    try {
      await this.database.withPerson(principal, (tx) =>
        tx.query(
          `INSERT INTO people.login_identity (person_id, group_id, provider, subject)
           VALUES ($1, access.current_group_id(), 'keycloak', $2)`,
          [person.id, created.subject],
        ),
      );
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
      personId: person.id,
      username: person.email,
      setup: created.temporaryPassword ? 'temporary_password' : 'email',
      temporaryPassword: created.temporaryPassword,
    };
  }
}
