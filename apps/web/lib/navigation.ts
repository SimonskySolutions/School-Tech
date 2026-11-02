import { type HomeView } from './home';

// The sidebar (docs/design.md): the same links the home page offers, grouped,
// from what the API says the person is. Only a guide to where to go: every
// page asks the API, which decides what the person may see.

export type IconName =
  | 'home'
  | 'bell'
  | 'tasks'
  | 'approvals'
  | 'employment'
  | 'basket'
  | 'apply'
  | 'students'
  | 'lessons'
  | 'uniforms'
  | 'staff'
  | 'documents'
  | 'photos'
  | 'today'
  | 'kitchen'
  | 'registers'
  | 'menus'
  | 'trips'
  | 'transport'
  | 'requests'
  | 'dietary'
  | 'inquiries'
  | 'applications'
  | 'pipeline'
  | 'reports'
  | 'setup'
  | 'accounting'
  | 'privacy';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export function navigation(view: HomeView): NavGroup[] {
  const groups: NavGroup[] = [];
  const overview: NavItem[] = [{ href: '/', label: 'Dashboard', icon: 'home' }];
  if (view.showsMyEmployment) overview.push({ href: '/tasks', label: 'Tasks', icon: 'tasks' });
  if (view.showsApprovals)
    overview.push({ href: '/documents/approvals', label: 'Approvals', icon: 'approvals' });
  if (view.showsMyEmployment)
    overview.push({ href: '/staff/me', label: 'My employment', icon: 'employment' });
  overview.push({ href: '/notifications', label: 'Notifications', icon: 'bell' });
  groups.push({ label: 'Overview', items: overview });

  if (view.children.length > 0) {
    groups.push({
      label: 'Family',
      items: [
        { href: '/services', label: 'Book lunch and clubs', icon: 'basket' },
        { href: '/admissions/apply', label: 'Apply for a place', icon: 'apply' },
      ],
    });
  }

  for (const role of view.schoolRoles) {
    const items: NavItem[] = [];
    if (role.studentsHref) items.push({ href: role.studentsHref, label: 'Students', icon: 'students' });
    if (role.staffHref) items.push({ href: role.staffHref, label: 'Staff', icon: 'staff' });
    items.push({ href: role.documentsHref, label: 'Documents', icon: 'documents' });
    if (role.lessonsHref) items.push({ href: role.lessonsHref, label: 'Lessons', icon: 'lessons' });
    if (role.uniformsHref) items.push({ href: role.uniformsHref, label: 'Uniforms', icon: 'uniforms' });
    if (role.consentsHref) items.push({ href: role.consentsHref, label: 'Photo consents', icon: 'photos' });
    groups.push({ label: role.school, items });
  }

  if (view.showsSchoolLife) {
    const items: NavItem[] = [
      { href: '/school-life/day', label: 'Today at school', icon: 'today' },
      { href: '/school-life/kitchen', label: 'Kitchen', icon: 'kitchen' },
      { href: '/school-life/registers', label: 'Club registers', icon: 'registers' },
      { href: '/school-life/menus', label: 'Lunch menus', icon: 'menus' },
      { href: '/school-life/trips', label: 'Trips', icon: 'trips' },
      { href: '/school-life/transport', label: 'Transport', icon: 'transport' },
    ];
    if (view.showsRequests)
      items.push({ href: '/school-life/requests', label: "Families' requests", icon: 'requests' });
    if (view.showsDietaryReview) {
      items.push({ href: '/school-life/dietary', label: 'Dietary needs', icon: 'dietary' });
    }
    groups.push({ label: 'School Life', items });
  }

  if (view.showsAdmissions) {
    groups.push({
      label: 'Admissions',
      items: [
        { href: '/admissions/inquiries', label: 'Inquiries', icon: 'inquiries' },
        { href: '/admissions/applications', label: 'Applications', icon: 'applications' },
        { href: '/admissions/pipeline', label: 'Pipeline', icon: 'pipeline' },
      ],
    });
  }

  const group: NavItem[] = [];
  if (view.showsReports) group.push({ href: '/reports/revenue', label: 'Revenue', icon: 'reports' });
  if (view.showsAdmissionsReport && !view.showsAdmissions) {
    group.push({ href: '/admissions/pipeline', label: 'Admissions', icon: 'pipeline' });
  }
  if (view.showsAccounting)
    group.push({ href: '/accounting', label: 'Accounting export', icon: 'accounting' });
  if (view.showsConsentWording)
    group.push({ href: '/privacy/consents', label: 'Consent wording', icon: 'privacy' });
  if (view.showsSchoolSetup)
    group.push({ href: '/admin/schools', label: 'Schools and set-up', icon: 'setup' });
  if (group.length > 0) groups.push({ label: 'Group', items: group });
  return groups;
}

/** "AI" from "Anna Ivanova". */
export function initials(givenName: string, familyName: string): string {
  return `${givenName.trim().charAt(0)}${familyName.trim().charAt(0)}`.toUpperCase();
}

/** Whether a link is the page being shown: the dashboard exactly, other links by prefix. */
export function isCurrent(href: string, path: string): boolean {
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
}
