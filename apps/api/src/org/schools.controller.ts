import { Controller, Get, Inject } from '@nestjs/common';
import { type SchoolId, type SchoolSummary } from '@pythagoras/shared';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database } from '../database/database';

interface SchoolRow {
  id: SchoolId;
  code: string;
  name: string;
  kind: string;
  time_zone: string;
  status: string;
}

// Active schools are public information; drafts are visible only to people who
// configure the group. Row-level security applies that rule.
@Controller('schools')
export class SchoolsController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  async list(@CurrentPrincipal() principal: Principal): Promise<SchoolSummary[]> {
    const rows = await this.database.withPerson(principal, (tx) =>
      tx.query<SchoolRow>(
        `SELECT id, code, name, kind, time_zone, status
           FROM org.school
          WHERE group_id = access.current_group_id()
          ORDER BY name`,
      ),
    );
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
      timeZone: row.time_zone,
      status: row.status,
    }));
  }
}
