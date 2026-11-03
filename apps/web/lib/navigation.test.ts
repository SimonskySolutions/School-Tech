import { type MeResponse, type PersonId, type SchoolId, type SchoolSummary } from '@pythagoras/shared';
import { describe, expect, it } from 'vitest';
import { buildHome } from './home';
import { initials, isCurrent, navigation } from './navigation';

const id = <T extends string>(value: string) => value as T;
const schools: SchoolSummary[] = ['School A', 'School B'].map((name, index) => ({
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
  language: null,
  email: null,
});

const labels = (me: MeResponse) =>
  navigation(buildHome(me, schools)).map((group) => [group.label, group.items.map((item) => item.label)]);

describe('navigation', () => {
  it('gives a parent the dashboard, notifications and the family pages', () => {
    const me: MeResponse = {
      person: person('Anna'),
      roles: [],
      children: [
        {
          id: id<PersonId>('mila'),
          givenName: 'Mila',
          familyName: 'Ivanova',
          relationship: 'parent',
          capabilities: { view: true, pay: true, manageBookings: true, consent: false },
          enrolments: [],
        },
      ],
    };
    expect(labels(me)).toEqual([
      ['Overview', ['Dashboard', 'Notifications']],
      ['Family', ['Book lunch and clubs', 'Apply for a place']],
    ]);
  });

  it('gives a principal their school, School Life and their own work', () => {
    const groups = navigation(
      buildHome(
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
      ),
    );
    expect(groups.map((group) => group.label)).toEqual([
      'Overview',
      'School A',
      'School Life',
      'Admissions',
      'Group',
    ]);
    expect(groups[0]?.items.map((item) => item.href)).toContain('/tasks');
    expect(groups[1]?.items.map((item) => item.href)).toEqual([
      '/schools/a/students',
      '/schools/a/staff',
      '/schools/a/documents',
      '/schools/a/lessons',
      '/schools/a/uniforms',
      '/schools/a/consents',
    ]);
  });

  it('offers nothing beyond the overview to someone with no children or roles', () => {
    expect(labels({ person: person('Teodora'), roles: [], children: [] })).toEqual([
      ['Overview', ['Dashboard', 'Notifications']],
    ]);
  });
});

describe('initials', () => {
  it('takes the first letter of each name, in capitals', () => {
    expect(initials('Anna', 'Ivanova')).toBe('AI');
    expect(initials(' мила', 'иванова')).toBe('МИ');
  });
});

describe('isCurrent', () => {
  it('marks the dashboard only on the home page', () => {
    expect(isCurrent('/', '/')).toBe(true);
    expect(isCurrent('/', '/tasks')).toBe(false);
  });

  it('marks a section on its own pages, not on pages that merely share a prefix', () => {
    expect(isCurrent('/tasks', '/tasks')).toBe(true);
    expect(isCurrent('/documents', '/documents/approvals')).toBe(true);
    expect(isCurrent('/school-life/day', '/school-life/dietary')).toBe(false);
    expect(isCurrent('/staff', '/staffing')).toBe(false);
  });
});
