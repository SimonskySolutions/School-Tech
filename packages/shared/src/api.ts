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

/** What a guardian can book for one child: offerings of the child's school with current prices. */
export interface StudentOfferings {
  student: { id: PersonId; givenName: string; familyName: string };
  offerings: BookableOffering[];
}

export interface BookableOffering {
  id: string;
  kind: 'lunch' | 'activity';
  name: string;
  school: { id: SchoolId; name: string };
  billingEntity: { id: string; name: string };
  price: { unitAmountMinor: number; currency: string; unit: string; vatRateBp: number };
  /** Lunch: pick days. Activity: the whole set of sessions is booked together. */
  pickSessions: boolean;
  sessions: {
    id: string;
    serviceDate: string | null;
    startsAt: string | null;
    endsAt: string | null;
    location: string | null;
    available: number | null;
    bookingCutoffAt: string | null;
    alreadyBooked: boolean;
  }[];
}

export interface CheckoutRequestBody {
  items: { studentId: string; offeringId: string; sessionIds?: string[] }[];
}

export interface CheckoutResponse {
  checkoutGroupId: string;
  /** One order and one payment per billing entity (ADR 0008). */
  orders: {
    orderId: string;
    orderNumber: string;
    billingEntityName: string;
    totalMinor: number;
    currency: string;
    paymentId: string;
    /** Null when the order already existed (repeated request) or the provider was unavailable. */
    checkoutUrl: string | null;
  }[];
}

export interface CheckoutGroupView {
  checkoutGroupId: string;
  orders: {
    orderId: string;
    orderNumber: string;
    status: string;
    billingEntityName: string;
    totalMinor: number;
    currency: string;
    expiresAt: string | null;
    paidAt: string | null;
    /** The provider's checkout page, while the order can still be paid. */
    checkoutUrl: string | null;
    payment: { id: string; status: string; provider: string; mode: string } | null;
    lines: {
      description: string;
      studentName: string | null;
      serviceDate: string | null;
      totalMinor: number;
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

/**
 * Lunch to prepare per school and day (School Life, kitchen). Counts include
 * paid bookings only; unpaid reservations are shown apart. Dietary needs are
 * listed only where the viewer may see them (never for the CEO).
 */
export interface KitchenCounts {
  from: string;
  days: number;
  schools: {
    school: { id: SchoolId; name: string; timeZone: string };
    showsDietary: boolean;
    days: {
      date: string;
      meals: number;
      awaitingPayment: number;
      capacity: number | null;
      dietary: {
        studentName: string | null;
        classLabel: string | null;
        kind: string;
        severity: string | null;
        description: string;
      }[];
    }[];
  }[];
}

/** Club and activity sessions with the children booked on them. */
export interface ActivityRegisters {
  from: string;
  days: number;
  sessions: {
    id: string;
    offering: { id: string; name: string };
    school: { id: SchoolId; name: string; timeZone: string };
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    capacity: number | null;
    booked: number;
    awaitingPayment: number;
    attendees: { studentName: string | null; classLabel: string | null; status: string }[];
  }[];
}

/** Money allocated to a school in a period, in minor units. net = received + paid by credit - refunded - credited. */
export interface RevenueFigures {
  receivedMinor: number;
  paidByCreditMinor: number;
  refundedMinor: number;
  creditedMinor: number;
  netMinor: number;
}

/**
 * Revenue per school for a period, and what is open today. Money from
 * test-mode payments (the development provider, Stripe test mode) is always
 * reported apart from live money and is never real revenue (ADR 0010).
 */
export interface RevenueReport {
  from: string;
  to: string;
  schools: {
    school: { id: SchoolId; name: string };
    currency: string;
    live: RevenueFigures;
    test: RevenueFigures;
    /** Staff invoices still unpaid, and the part of it past its due date. */
    openInvoices: number;
    outstandingMinor: number;
    overdueMinor: number;
    /** Family checkouts placed but not paid yet (seats held). */
    checkoutInProgressMinor: number;
    /** Credit families hold from this school's cancelled or unplaceable lines. */
    creditOwed: { liveMinor: number; testMinor: number };
  }[];
  totals: { currency: string; live: RevenueFigures; test: RevenueFigures }[];
}

/** Children booked for lunch at one school on one day, for staff who may cancel a day. */
export interface LunchList {
  school: { id: SchoolId; name: string };
  date: string;
  /** The viewer holds bookings.manage at this school and the day has not passed. */
  canCancel: boolean;
  bookings: {
    bookingId: string;
    studentName: string | null;
    classLabel: string | null;
    status: 'confirmed' | 'cancelled' | 'attended' | 'absent';
  }[];
}

export interface CancelBookingRequest {
  reason: string;
}

/** The booking is cancelled now; the worker issues the credit moments later. */
export interface CancelBookingResponse {
  bookingId: string;
  status: 'cancelled';
  creditAmountMinor: number;
  currency: string;
}

/** What a group administrator works with when adding a school. */
export interface OnboardingOverview {
  billingEntities: { id: string; legalName: string; registrationNumber: string; status: string }[];
  serviceDefinitions: { id: string; code: string; kind: string; name: string }[];
  schools: {
    id: SchoolId;
    code: string;
    name: string;
    kind: string;
    status: string;
    timeZone: string;
    billingEntityId: string;
    publishedOfferings: number;
    sessions: number;
    principals: number;
    /** What still stops a draft school from going live; empty when ready. */
    missing: string[];
  }[];
}

export interface CreateSchoolRequest {
  code: string;
  name: string;
  kind: 'school' | 'kindergarten' | 'sports_academy' | 'training_centre' | 'college' | 'other';
  timeZone: string;
  billingEntityId: string;
}

export interface CreateOfferingRequest {
  serviceDefinitionId: string;
  name: string;
  unitAmountMinor: number;
  priceUnit: 'per_session' | 'per_day' | 'per_month' | 'per_term' | 'one_off';
  vatRateBp?: number;
}

export type SessionSchedule =
  | { type: 'school_days'; from: string; to: string; closed?: string[] }
  | {
      type: 'weekly';
      weekday: number;
      startTime: string;
      endTime: string;
      from: string;
      to: string;
      closed?: string[];
    };

export interface CreateSessionsRequest {
  offeringId: string;
  capacity: number;
  location?: string;
  schedule: SessionSchedule;
}

export interface CreateStaffRequest {
  givenName: string;
  familyName: string;
  email: string;
  roleCode: 'principal' | 'school_admin' | 'teacher' | 'kitchen';
}

/** A sign-in account was created for a registered person (M3.2). */
export interface CreatedAccountResponse {
  personId: string;
  username: string;
  /** temporary_password: development only; the person must change it at first sign-in. */
  setup: 'temporary_password' | 'email';
  temporaryPassword: string | null;
}

/** Current students of one school with their guardians (M3.3), for staff. */
export interface StudentList {
  school: { id: SchoolId; name: string };
  students: {
    id: PersonId;
    givenName: string;
    familyName: string;
    academicYear: string;
    gradeLevel: string | null;
    classLabel: string | null;
    guardians: {
      personId: PersonId;
      name: string;
      relationship: string;
      status: 'pending' | 'active';
      canPay: boolean;
      canManageBookings: boolean;
      canConsent: boolean;
    }[];
  }[];
}

export interface EnrolStudentRequest {
  givenName: string;
  familyName: string;
  dateOfBirth?: string;
  academicYear: string;
  gradeLevel?: string;
  classLabel?: string;
  startDate: string;
}

/** Records a guardian: an existing person found by exact e-mail, or a new one (names required). */
export interface AddGuardianRequest {
  email: string;
  givenName?: string;
  familyName?: string;
  relationship: 'mother' | 'father' | 'parent' | 'legal_guardian' | 'foster_carer' | 'other';
  canPay?: boolean;
  canManageBookings?: boolean;
  canConsent?: boolean;
}

export interface AddGuardianResponse {
  guardianPersonId: PersonId;
  /** True when the guardian already existed (for example a parent with children at another school). */
  existing: boolean;
}

/** Everything the set-up page shows for one school (M3.4). */
export interface SchoolSetup {
  school: OnboardingOverview['schools'][number];
  billingEntityName: string;
  serviceDefinitions: OnboardingOverview['serviceDefinitions'];
  offerings: {
    id: string;
    name: string;
    kind: string;
    status: string;
    price: { unitAmountMinor: number; currency: string; unit: string } | null;
    sessions: number;
    firstDate: string | null;
    lastDate: string | null;
  }[];
  staff: {
    personId: PersonId;
    name: string;
    email: string | null;
    roleCode: string;
    roleName: string;
    hasAccount: boolean;
  }[];
}

/** The public website a host name belongs to (M3.5), for rendering its pages. */
export interface SiteInfo {
  websiteId: string;
  code: string;
  name: string;
  purpose: 'school' | 'group' | 'family_portal' | 'campaign';
  /** The website's tenant in the CMS; null for sites without CMS content (the portal). */
  cmsKey: string | null;
  locale: string;
  schools: { name: string; kind: string }[];
}
