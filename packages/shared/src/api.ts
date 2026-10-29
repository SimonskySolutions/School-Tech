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
