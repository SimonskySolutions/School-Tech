// Response shapes of the Pythagoras API, shared by the API (which produces them)
// and the web app (which reads them).

import { type PersonId, type SchoolId } from './ids.js';

export type RoleScope = 'group' | 'school';

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
    scope: RoleScope;
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

export interface SchoolSummary {
  id: SchoolId;
  code: string;
  name: string;
  kind: string;
  timeZone: string;
  status: string;
}
