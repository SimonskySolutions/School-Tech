import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type SchoolWaitingLists, type StudentWaitingList } from '@pythagoras/shared';
import { z } from 'zod';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { parse, Refused, runner } from '../common/school-work';
import { Database, type PersonTransaction } from '../database/database';

// Waiting lists for full clubs. The database orders the queue and tells the next
// family when a place comes free.

const run = runner({
  PY031: [409, 'this club still has places: book it instead'],
  '23505': [409, 'this child is already on the waiting list'],
});

export const joinSchema = z.object({ offeringId: z.uuid() });

const QUEUE_POSITION = 'scheduling.queue_position(w.id)';

@Controller('students/:studentId/waiting-list')
export class StudentWaitingController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentWaitingList> {
    return run(this.database, principal, async (tx: PersonTransaction) => {
      const rows = await tx.query<{
        id: string;
        offering_name: string;
        status: 'waiting' | 'place_free';
        position: number;
      }>(
        `SELECT w.id, o.name AS offering_name, w.status, ${QUEUE_POSITION} AS position
           FROM scheduling.waiting_entry w
           JOIN catalog.school_offering o ON o.id = w.offering_id
          WHERE w.student_person_id = $1 AND w.status IN ('waiting', 'place_free')
          ORDER BY w.created_at`,
        [studentId],
      );
      return {
        entries: rows.map((row) => ({
          id: row.id,
          offeringName: row.offering_name,
          status: row.status,
          position: row.position,
        })),
      };
    });
  }

  @Post()
  @HttpCode(201)
  join(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
    @Body() body: unknown,
  ) {
    const { offeringId } = parse(joinSchema, body);
    return run(this.database, principal, async (tx) => {
      const [row] = await tx.query<{ id: string }>('SELECT scheduling.join_waiting_list($1, $2) AS id', [
        offeringId,
        studentId,
      ]);
      return row!;
    });
  }

  @Delete(':entryId')
  @HttpCode(204)
  async leave(
    @CurrentPrincipal() principal: Principal,
    @Param('entryId', new ParseUUIDPipe()) entryId: string,
  ): Promise<void> {
    await run(this.database, principal, (tx) =>
      tx.query('SELECT scheduling.leave_waiting_list($1)', [entryId]),
    );
  }
}

@Controller('schools/:schoolId/waiting-lists')
export class SchoolWaitingController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  lists(
    @CurrentPrincipal() principal: Principal,
    @Param('schoolId', new ParseUUIDPipe()) schoolId: string,
  ): Promise<SchoolWaitingLists> {
    return run(this.database, principal, async (tx) => {
      const [school] = await tx.query<{ id: string; name: string }>(
        `SELECT id, name FROM org.school
          WHERE id = $1 AND (access.has_permission('enrolment.read', id) OR access.has_permission('bookings.read', id))`,
        [schoolId],
      );
      if (!school) throw new Refused(404, 'no such school, or not yours to see');
      const rows = await tx.query<{
        id: string;
        offering_name: string;
        student: string;
        status: 'waiting' | 'place_free';
        position: number;
        since: string;
      }>(
        `SELECT w.id, o.name AS offering_name, p.given_name || ' ' || p.family_name AS student, w.status,
                ${QUEUE_POSITION} AS position, to_char(w.created_at, 'YYYY-MM-DD') AS since
           FROM scheduling.waiting_entry w
           JOIN catalog.school_offering o ON o.id = w.offering_id
           JOIN people.person p ON p.id = w.student_person_id
          WHERE w.school_id = $1 AND w.status IN ('waiting', 'place_free')
          ORDER BY o.name, w.created_at, w.id`,
        [schoolId],
      );
      return {
        school,
        entries: rows.map((row) => ({
          id: row.id,
          offeringName: row.offering_name,
          student: row.student,
          status: row.status,
          position: row.position,
          since: row.since,
        })),
      };
    });
  }
}
