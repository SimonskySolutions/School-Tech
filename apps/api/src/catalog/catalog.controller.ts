import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  type BookableOffering,
  type PersonId,
  type SchoolId,
  type StudentOfferings,
} from '@pythagoras/shared';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database } from '../database/database';
import { dishesBySession } from '../school-life/menus';
import {
  findBookableOfferings,
  findBookedSessionIds,
  findOpenSessions,
  findStudentWithSchools,
  pickSessions,
} from './catalog.repository';

@Controller('students')
export class CatalogController {
  constructor(@Inject(Database) private readonly database: Database) {}

  /** What the signed-in guardian can book for this child (404 if the child is not theirs to see). */
  @Get(':studentId/offerings')
  offerings(
    @CurrentPrincipal() principal: Principal,
    @Param('studentId', new ParseUUIDPipe()) studentId: string,
  ): Promise<StudentOfferings> {
    return this.database.withPerson(principal, async (tx) => {
      const found = await findStudentWithSchools(tx, studentId);
      if (!found || found.schoolIds.length === 0) {
        throw new NotFoundException('no current enrolment for this child');
      }
      const offerings = await findBookableOfferings(tx, found.schoolIds);
      const sessions = offerings.length
        ? await findOpenSessions(
            tx,
            offerings.map((o) => o.id),
          )
        : [];
      const booked = await findBookedSessionIds(tx, studentId);
      const lunchIds = new Set(offerings.filter((o) => o.kind === 'lunch').map((o) => o.id));
      const menus = await dishesBySession(
        tx,
        sessions.filter((session) => lunchIds.has(session.offering_id)).map((session) => session.id),
      );

      return {
        student: {
          id: found.student.id as PersonId,
          givenName: found.student.given_name,
          familyName: found.student.family_name,
        },
        offerings: offerings.map((offering): BookableOffering => ({
          id: offering.id,
          kind: offering.kind,
          name: offering.name,
          school: { id: offering.school_id as SchoolId, name: offering.school_name },
          billingEntity: { id: offering.billing_entity_id, name: offering.billing_entity_name },
          price: {
            unitAmountMinor: Number(offering.unit_amount_minor),
            currency: offering.currency,
            unit: offering.price_unit,
            vatRateBp: offering.vat_rate_bp,
          },
          pickSessions: pickSessions(offering.kind, offering.price_unit),
          sessions: sessions
            .filter((session) => session.offering_id === offering.id)
            .map((session) => ({
              id: session.id,
              serviceDate: session.service_date,
              startsAt: session.starts_at?.toISOString() ?? null,
              endsAt: session.ends_at?.toISOString() ?? null,
              location: session.location_label,
              available: session.available,
              bookingCutoffAt: session.booking_cutoff_at?.toISOString() ?? null,
              alreadyBooked: booked.has(session.id),
              menu: menus.get(session.id) ?? [],
            })),
        })),
      };
    });
  }
}
