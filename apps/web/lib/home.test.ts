import { type MeResponse, type PersonId, type SchoolId, type SchoolSummary } from '@pythagoras/shared';
import { describe, expect, it } from 'vitest';
import { buildHome } from './home';

const id = <T extends string>(value: string) => value as T;
const school = (code: string, name: string) => ({ id: id<SchoolId>(code), code, name });
const schools: SchoolSummary[] = ['School A', 'School B', 'School C'].map((name, index) => ({
  id: id<SchoolId>(`s${index}`),
  code: `s${index}`,
  name,
  kind: 'school',
  timeZone: 'Europe/Sofia',
  status: 'active',
}));

const person = (givenName: string): MeResponse['person'] => ({
  id: id<PersonId>(givenName),
  givenName,
  familyName: 'Test',
  preferredName: null,
  email: null,
});

const capabilities = { view: true, pay: true, manageBookings: true, consent: false };

describe('buildHome', () => {
  it('shows a parent their children and where they study', () => {
    const view = buildHome(
      {
        person: person('Anna'),
        roles: [],
        children: [
          {
            id: id<PersonId>('mila'),
            givenName: 'Mila',
            familyName: 'Ivanova',
            relationship: 'parent',
            capabilities,
            enrolments: [
              {
                school: school('a', 'School A'),
                academicYear: '2026/2027',
                gradeLevel: '3',
                classLabel: '3A',
                status: 'active',
              },
            ],
          },
        ],
      },
      schools,
    );
    expect(view.greeting).toBe('Hello, Anna');
    expect(view.children).toEqual([{ id: 'mila', name: 'Mila Ivanova', places: ['School A, class 3A'] }]);
    expect(view.groupRoles).toEqual([]);
    expect(view.groupSchools).toEqual([]);
    expect(view.hasNothing).toBe(false);
  });

  it('shows school staff their school and role', () => {
    const view = buildHome(
      {
        person: person('Petar'),
        roles: [
          {
            code: 'principal',
            name: 'Principal',
            scope: 'school',
            school: { id: id<SchoolId>('a'), name: 'School A' },
          },
        ],
        children: [],
      },
      schools,
    );
    expect(view.schoolRoles).toEqual([
      { role: 'Principal', school: 'School A', studentsHref: '/schools/a/students' },
    ]);
    expect(view.groupSchools).toEqual([]);
    expect(view.showsSchoolLife).toBe(true);
  });

  it('shows group roles every school', () => {
    const view = buildHome(
      {
        person: person('Elena'),
        roles: [{ code: 'group_ceo', name: 'CEO', scope: 'group', school: null }],
        children: [],
      },
      schools,
    );
    expect(view.groupRoles).toEqual(['CEO']);
    expect(view.groupSchools).toEqual(['School A', 'School B', 'School C']);
  });

  it('offers School Life pages only to roles that can read bookings', () => {
    const roles = (code: string) => [{ code, name: code, scope: 'group' as const, school: null }];
    expect(
      buildHome({ person: person('Iva'), roles: roles('school_life_coordinator'), children: [] }, schools)
        .showsSchoolLife,
    ).toBe(true);
    expect(
      buildHome({ person: person('Nikolay'), roles: roles('privacy_officer'), children: [] }, schools)
        .showsSchoolLife,
    ).toBe(false);
    expect(buildHome({ person: person('Teodora'), roles: [], children: [] }, schools).showsSchoolLife).toBe(
      false,
    );
  });

  it('offers reports to management roles but not to teachers or the kitchen', () => {
    const roles = (code: string) => [{ code, name: code, scope: 'group' as const, school: null }];
    const reports = (code: string) =>
      buildHome({ person: person('X'), roles: roles(code), children: [] }, schools).showsReports;
    expect(reports('group_ceo')).toBe(true);
    expect(reports('principal')).toBe(true);
    expect(reports('teacher')).toBe(false);
    expect(reports('kitchen')).toBe(false);
  });

  it('offers school set-up to the group administrator but not to principals', () => {
    const setup = (code: string) =>
      buildHome(
        { person: person('X'), roles: [{ code, name: code, scope: 'group', school: null }], children: [] },
        schools,
      ).showsSchoolSetup;
    expect(setup('group_admin')).toBe(true);
    expect(setup('principal')).toBe(false);
  });

  it('says so when nothing is linked yet', () => {
    expect(buildHome({ person: person('Teodora'), roles: [], children: [] }, schools).hasNothing).toBe(true);
  });
});
