import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import { type PersonId, type SchoolId } from '@pythagoras/shared';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { Database } from '../database/database';
import { findCurrentEnrolments, findMe, findMyChildren, findMyRoles } from './me.repository';

export interface MeResponse {
  person: {
    id: PersonId;
    givenName: string;
    familyName: string;
    preferredName: string | null;
    email: string | null;
  };
  roles: {
    code: string;
    name: string;
    scope: 'group' | 'school';
    school: { id: SchoolId; name: string } | null;
  }[];
  children: {
    id: PersonId;
    givenName: string;
    familyName: string;
    relationship: string;
    capabilities: { view: boolean; pay: boolean; manageBookings: boolean; consent: boolean };
    enrolments: {
      school: { id: SchoolId; code: string; name: string };
      academicYear: string;
      gradeLevel: string | null;
      classLabel: string | null;
      status: string;
    }[];
  }[];
}

@Controller('me')
export class MeController {
  constructor(@Inject(Database) private readonly database: Database) {}

  @Get()
  async me(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    return this.database.withPerson(principal, async (tx) => {
      const [person] = await findMe(tx);
      if (!person) {
        throw new NotFoundException('person not found');
      }
      const roles = await findMyRoles(tx);
      const children = await findMyChildren(tx);
      const enrolments = await findCurrentEnrolments(
        tx,
        children.map((child) => child.id),
      );

      return {
        person: {
          id: person.id,
          givenName: person.given_name,
          familyName: person.family_name,
          preferredName: person.preferred_name,
          email: person.email,
        },
        roles: roles.map((role) => ({
          code: role.role_code,
          name: role.role_name,
          scope: role.scope_level,
          school: role.school_id && role.school_name ? { id: role.school_id, name: role.school_name } : null,
        })),
        children: children.map((child) => ({
          id: child.id,
          givenName: child.given_name,
          familyName: child.family_name,
          relationship: child.relationship,
          capabilities: {
            view: child.can_view,
            pay: child.can_pay,
            manageBookings: child.can_manage_bookings,
            consent: child.can_consent,
          },
          enrolments: enrolments
            .filter((enrolment) => enrolment.student_person_id === child.id)
            .map((enrolment) => ({
              school: { id: enrolment.school_id, code: enrolment.school_code, name: enrolment.school_name },
              academicYear: enrolment.academic_year,
              gradeLevel: enrolment.grade_level,
              classLabel: enrolment.class_label,
              status: enrolment.status,
            })),
        })),
      };
    });
  }
}
