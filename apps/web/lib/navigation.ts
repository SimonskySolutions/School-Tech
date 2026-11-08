import { type HomeView } from './home';
import { en } from './i18n/en';
import { type Messages } from './i18n/messages';

// The sidebar (docs/design.md): the same links the home page offers, grouped,
// from what the API says the person is. Only a guide to where to go: every
// page asks the API, which decides what the person may see.

export type IconName =
  | 'home'
  | 'menu'
  | 'overview'
  | 'inventory'
  | 'finance'
  | 'waiting'
  | 'classes'
  | 'timetable'
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

export function navigation(view: HomeView, text: Messages = en): NavGroup[] {
  const t = text.nav;
  const groups: NavGroup[] = [];
  const overview: NavItem[] = [{ href: '/', label: t.dashboard, icon: 'home' }];
  if (view.showsMyEmployment) overview.push({ href: '/tasks', label: t.tasks, icon: 'tasks' });
  if (view.showsApprovals)
    overview.push({ href: '/documents/approvals', label: t.approvals, icon: 'approvals' });
  if (view.showsMyEmployment) overview.push({ href: '/staff/me', label: t.myEmployment, icon: 'employment' });
  overview.push({ href: '/notifications', label: t.notifications, icon: 'bell' });
  groups.push({ label: t.overview, items: overview });

  if (view.children.length > 0) {
    groups.push({
      label: t.family,
      items: [
        { href: '/services', label: t.bookLunchAndClubs, icon: 'basket' },
        { href: '/invoices', label: t.invoices, icon: 'documents' },
        { href: '/admissions/apply', label: t.applyForPlace, icon: 'apply' },
      ],
    });
  }

  for (const role of view.schoolRoles) {
    const items: NavItem[] = [];
    if (role.studentsHref) items.push({ href: role.studentsHref, label: t.students, icon: 'students' });
    if (role.staffHref) items.push({ href: role.staffHref, label: t.staff, icon: 'staff' });
    items.push({ href: role.documentsHref, label: t.documents, icon: 'documents' });
    if (role.classesHref) items.push({ href: role.classesHref, label: t.classes, icon: 'classes' });
    if (role.timetableHref) items.push({ href: role.timetableHref, label: t.timetable, icon: 'timetable' });
    if (role.waitingHref) items.push({ href: role.waitingHref, label: t.waitingLists, icon: 'waiting' });
    if (role.lessonsHref) items.push({ href: role.lessonsHref, label: t.lessons, icon: 'lessons' });
    if (role.uniformsHref) items.push({ href: role.uniformsHref, label: t.uniforms, icon: 'uniforms' });
    if (role.inventoryHref) items.push({ href: role.inventoryHref, label: t.inventory, icon: 'inventory' });
    if (role.financeHref) items.push({ href: role.financeHref, label: t.finance, icon: 'finance' });
    if (role.consentsHref) items.push({ href: role.consentsHref, label: t.photoConsents, icon: 'photos' });
    groups.push({ label: role.school, items });
  }

  if (view.showsSchoolLife) {
    const items: NavItem[] = [
      { href: '/school-life/day', label: t.todayAtSchool, icon: 'today' },
      { href: '/school-life/kitchen', label: t.kitchen, icon: 'kitchen' },
      { href: '/school-life/registers', label: t.clubRegisters, icon: 'registers' },
      { href: '/school-life/menus', label: t.lunchMenus, icon: 'menus' },
      { href: '/school-life/trips', label: t.trips, icon: 'trips' },
      { href: '/school-life/transport', label: t.transport, icon: 'transport' },
    ];
    if (view.showsRequests)
      items.push({ href: '/school-life/requests', label: t.familiesRequests, icon: 'requests' });
    if (view.showsDietaryReview) {
      items.push({ href: '/school-life/dietary', label: t.dietaryNeeds, icon: 'dietary' });
    }
    groups.push({ label: t.schoolLife, items });
  }

  if (view.showsAdmissions) {
    groups.push({
      label: t.admissions,
      items: [
        { href: '/admissions/inquiries', label: t.inquiries, icon: 'inquiries' },
        { href: '/admissions/applications', label: t.applications, icon: 'applications' },
        { href: '/admissions/pipeline', label: t.pipeline, icon: 'pipeline' },
      ],
    });
  }

  const group: NavItem[] = [];
  if (view.showsGroupOverview) group.push({ href: '/group', label: t.allSchools, icon: 'overview' });
  if (view.showsReports) group.push({ href: '/reports/revenue', label: t.revenue, icon: 'reports' });
  if (view.showsAdmissionsReport && !view.showsAdmissions) {
    group.push({ href: '/admissions/pipeline', label: t.admissions, icon: 'pipeline' });
  }
  if (view.showsAccounting)
    group.push({ href: '/accounting', label: t.accountingExport, icon: 'accounting' });
  if (view.showsConsentWording)
    group.push({ href: '/privacy/consents', label: t.consentWording, icon: 'privacy' });
  if (view.showsSchoolSetup) group.push({ href: '/admin/schools', label: t.schoolsAndSetup, icon: 'setup' });
  if (group.length > 0) groups.push({ label: t.group, items: group });
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
