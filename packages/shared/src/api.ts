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
  /** Uniforms at the child's schools, by variant (ADR 0025). */
  uniforms: UniformProduct[];
}

/** A uniform product with its variants, prices and free stock. */
export interface UniformProduct {
  id: string;
  name: string;
  school: { id: SchoolId; name: string };
  billingEntity: { id: string; name: string };
  variants: {
    id: string;
    sku: string;
    size: string | null;
    colour: string | null;
    price: { unitAmountMinor: number; currency: string };
    /** Items free to buy now (not held by other orders). */
    available: number;
  }[];
}

export interface BookableOffering {
  id: string;
  kind: 'lunch' | 'activity' | 'lesson' | 'trip' | 'transport';
  name: string;
  school: { id: SchoolId; name: string };
  billingEntity: { id: string; name: string };
  price: { unitAmountMinor: number; currency: string; unit: string; vatRateBp: number };
  /** Lunch: pick days. Activity: the whole set of sessions is booked together. */
  pickSessions: boolean;
  /** Lessons: bought as a package of this many lessons, then booked slot by slot (sessions is empty). */
  package: { lessons: number } | null;
  /** Trips: a guardian's permission for the current wording is needed before booking (ADR 0023). */
  consent: { given: boolean } | null;
  /** Transport: the route and its stops; the basket names the child's stop (ADR 0024). */
  route: TransportRoute | null;
  /** Who may take it, and why this child may not (null when they may). The database checks it again. */
  eligibility: { rules: EligibilityRules; problem: string | null };
  sessions: {
    id: string;
    serviceDate: string | null;
    startsAt: string | null;
    endsAt: string | null;
    location: string | null;
    available: number | null;
    bookingCutoffAt: string | null;
    alreadyBooked: boolean;
    /** Lunch: the day's menu, empty until School Life publishes it. */
    menu: MenuDish[];
  }[];
}

export interface CheckoutRequestBody {
  /** stopId: the child's stop, for a transport seat; variantId and quantity: a uniform variant. */
  items: {
    studentId: string;
    offeringId: string;
    sessionIds?: string[];
    stopId?: string;
    variantId?: string;
    quantity?: number;
  }[];
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
      /** Every dish served that day, across the school's lunch offerings. */
      menu: MenuDish[];
      dietary: {
        studentName: string | null;
        classLabel: string | null;
        kind: string;
        severity: string | null;
        description: string;
        allergens: Allergen[];
        verified: boolean;
        /** Dishes on this child's menu that day containing one of their declared allergens. */
        menuConflicts: { dish: string; allergens: Allergen[] }[];
      }[];
    }[];
  }[];
}

/**
 * The 14 allergens food businesses must declare (EU Regulation 1169/2011,
 * Annex II), as the codes the database accepts (`catalog.allergen_codes()`).
 */
export const ALLERGENS = {
  gluten: 'Cereals containing gluten',
  crustaceans: 'Crustaceans',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  soybeans: 'Soybeans',
  milk: 'Milk',
  nuts: 'Tree nuts',
  celery: 'Celery',
  mustard: 'Mustard',
  sesame: 'Sesame',
  sulphites: 'Sulphur dioxide and sulphites',
  lupin: 'Lupin',
  molluscs: 'Molluscs',
} as const;
export type Allergen = keyof typeof ALLERGENS;
export const ALLERGEN_CODES = Object.keys(ALLERGENS) as Allergen[];

export const MENU_COURSES = ['starter', 'soup', 'main', 'side', 'dessert', 'drink', 'other'] as const;
export type MenuCourse = (typeof MENU_COURSES)[number];

export interface MenuDish {
  course: MenuCourse;
  name: string;
  allergens: Allergen[];
}

/** Lunch days and their menus, for staff who publish or read them. */
export interface LunchMenus {
  from: string;
  days: number;
  schools: {
    school: { id: SchoolId; name: string };
    /** The viewer holds menus.manage at this school. */
    canEdit: boolean;
    days: { date: string; sessionId: string; offeringName: string; dishes: MenuDish[] }[];
  }[];
}

export interface SetMenuRequest {
  dishes: MenuDish[];
}

export const DIETARY_KINDS = [
  'allergy',
  'intolerance',
  'medical_diet',
  'religious_or_cultural',
  'vegetarian',
  'vegan',
  'other',
] as const;
export type DietaryKind = (typeof DIETARY_KINDS)[number];
export const DIETARY_SEVERITIES = ['information', 'moderate', 'severe', 'life_threatening'] as const;
export type DietarySeverity = (typeof DIETARY_SEVERITIES)[number];

/** A child's dietary or health need, as a guardian or School Life sees it. */
export interface DietaryNeed {
  id: string;
  kind: DietaryKind;
  description: string;
  severity: DietarySeverity | null;
  allergens: Allergen[];
  validFrom: string;
  validUntil: string | null;
  verified: boolean;
  verifiedAt: string | null;
}

export interface DietaryNeedRequest {
  kind: DietaryKind;
  description: string;
  severity?: DietarySeverity | null;
  allergens: Allergen[];
}

/** A guardian's view of one child's needs. */
export interface StudentDietary {
  student: { id: PersonId; givenName: string; familyName: string };
  /** The guardian may record and change needs (they manage the child's bookings). */
  canChange: boolean;
  needs: (DietaryNeed & {
    /** An unverified need this guardian recorded may be taken back; others are ended. */
    canWithdraw: boolean;
  })[];
}

/** Current needs at the schools the viewer may see them, for School Life to verify. */
export interface DietaryReview {
  schools: {
    school: { id: SchoolId; name: string };
    /** The viewer holds sensitive.dietary.manage at this school. */
    canVerify: boolean;
    needs: (DietaryNeed & { studentName: string; classLabel: string | null })[];
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
    /** The session has started and the viewer may mark attendance at this school. */
    canMark: boolean;
    attendees: {
      bookingId: string;
      studentName: string | null;
      classLabel: string | null;
      status: string;
    }[];
  }[];
}

export interface MarkAttendanceRequest {
  status: 'attended' | 'absent';
}

/** A guardian's view of one child's club meetings and attendance. */
export interface StudentActivities {
  student: { id: PersonId; givenName: string; familyName: string };
  sessions: {
    offeringName: string;
    schoolName: string;
    timeZone: string;
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    /** The meeting has started (judged by the server). */
    started: boolean;
    /** confirmed (booked), attended or absent. */
    status: 'confirmed' | 'attended' | 'absent';
  }[];
}

/** Who may take an offering: grades at the school, ages on the day (whole years). Each part optional. */
export interface EligibilityRules {
  grades?: string[];
  minAge?: number;
  maxAge?: number;
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
  priceUnit: 'per_session' | 'per_day' | 'per_month' | 'per_term' | 'per_package' | 'one_off';
  /** Lessons in one package; required with per_package. */
  packageSize?: number;
  vatRateBp?: number;
  eligibility?: EligibilityRules;
}

export type SessionSchedule =
  | { type: 'school_days'; from: string; to: string; closed?: string[] }
  | { type: 'once'; date: string; startTime: string; endTime: string }
  /** A whole term, for transport: the first and the last day (ADR 0024). */
  | { type: 'term'; from: string; to: string; label?: string }
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
  /** What the viewer may do here: enrol students (enrolment.manage), record guardians (guardians.manage). */
  canEnrol: boolean;
  canRecordGuardians: boolean;
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
/** A school's own website (M3.5): live together with the school. */
export interface SchoolWebsite {
  websiteId: string;
  code: string;
  status: 'draft' | 'live' | 'archived';
  cmsKey: string | null;
  hostnames: WebsiteDomain[];
}

/** One address a website answers on (M3.6). Real domains wait for proof of ownership. */
export interface WebsiteDomain {
  id: string;
  hostname: string;
  status: 'pending' | 'verified' | 'failed' | 'disabled';
  method: 'dns_txt' | 'http_token' | 'local_development';
  lastCheckedAt: string | null;
  /** A verified domain whose record a daily re-check did not find: when that started, and when the domain stops. */
  missingSince: string | null;
  stopsAt: string | null;
  /** The DNS record the school must create (or put back), while it is needed. */
  instructions: { type: 'TXT'; name: string; value: string } | null;
}

export interface CreatedWebsiteResponse extends SchoolWebsite {
  existing: boolean;
  /** Whether the website's space in the CMS was added, already there, or could not be reached (try again). */
  cms: 'created' | 'existing' | 'unavailable' | 'not_configured';
}

export interface SchoolSetup {
  school: OnboardingOverview['schools'][number];
  billingEntityName: string;
  website: SchoolWebsite | null;
  serviceDefinitions: OnboardingOverview['serviceDefinitions'];
  offerings: {
    id: string;
    name: string;
    kind: string;
    status: string;
    price: { unitAmountMinor: number; currency: string; unit: string } | null;
    eligibility: EligibilityRules;
    /** Trips: the consent wording in force. */
    tripConsent: { version: number; text: string } | null;
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

/** A lesson slot: one place, a teacher and a room (ADR 0022). */
export interface LessonSlot {
  sessionId: string;
  offeringId: string;
  offeringName: string;
  schoolName: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  teacher: string | null;
  room: string | null;
}

/** A guardian's view of one child's lessons. */
export interface StudentLessons {
  student: { id: PersonId; givenName: string; familyName: string };
  /** The guardian manages the child's bookings. */
  canBook: boolean;
  packages: {
    id: string;
    offeringId: string;
    offeringName: string;
    schoolName: string;
    lessonsBought: number;
    lessonsLeft: number;
    boughtAt: string;
  }[];
  /** Free slots of the lessons the child has packages with lessons left for, the next three weeks. */
  slots: LessonSlot[];
  bookings: (LessonSlot & {
    bookingId: string;
    status: 'confirmed' | 'attended' | 'absent';
    canCancel: boolean;
    /** Cancelling now gives the lesson back (before the cutoff); otherwise it counts as used. */
    cancelReturnsLesson: boolean;
    cancellationCutoffAt: string | null;
  })[];
}

export interface BookLessonRequest {
  sessionId: string;
  packageId: string;
}

/** Teachers, rooms, their hours and the lesson slots of one school, for staff. */
export interface SchoolLessons {
  from: string;
  days: number;
  school: { id: SchoolId; name: string; timeZone: string };
  /** The viewer holds catalog.manage here: adds teachers, rooms, hours and slots. */
  canManage: boolean;
  resources: {
    id: string;
    kind: 'teacher' | 'room';
    displayName: string;
    active: boolean;
    /** Weekly hours in the school's time: ISO weekday (1 = Monday), HH:MM. */
    hours: { id: string; weekday: number; starts: string; ends: string }[];
  }[];
  offerings: { id: string; name: string; packageSize: number | null }[];
  slots: (LessonSlot & { booked: boolean; bookedFor: string | null })[];
}

/** A guardian's view of the upcoming trips at one child's schools (ADR 0023). */
export interface StudentTrips {
  student: { id: PersonId; givenName: string; familyName: string };
  /** This guardian may give permission for the child. */
  canConsent: boolean;
  trips: {
    sessionId: string;
    offeringId: string;
    name: string;
    schoolName: string;
    timeZone: string;
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    available: number | null;
    bookingCutoffAt: string | null;
    price: { unitAmountMinor: number; currency: string } | null;
    /** The wording a guardian agrees to; null until the school has written it. */
    consent: { policyVersionId: string; wording: string } | null;
    permission: {
      id: string;
      givenAt: string;
      channel: 'family_portal' | 'paper' | 'in_person';
      givenByMe: boolean;
      emergencyContactName: string;
      emergencyContactPhone: string;
      /** Given to the wording in force now; otherwise it must be given again before booking. */
      forCurrentWording: boolean;
    } | null;
    booking: 'reserved' | 'confirmed' | 'attended' | 'absent' | null;
  }[];
}

export interface GiveTripPermissionRequest {
  policyVersionId: string;
  agree: true;
  emergencyContactName: string;
  emergencyContactPhone: string;
}

/** Trips for the school's staff, with who is coming. */
export interface TripParticipants {
  from: string;
  days: number;
  trips: {
    sessionId: string;
    name: string;
    school: { id: SchoolId; name: string; timeZone: string };
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    capacity: number | null;
    booked: number;
    awaitingPayment: number;
    participants: {
      studentName: string | null;
      classLabel: string | null;
      status: string;
      permission: {
        givenAt: string;
        channel: 'family_portal' | 'paper' | 'in_person';
        givenBy: string | null;
      } | null;
      emergencyContact: { name: string; phone: string } | null;
      /** Only for staff who may read dietary and health needs. */
      dietary: { kind: string; severity: string | null; description: string }[];
    }[];
  }[];
}

/** A bus route: vehicle, ISO weekdays it runs, stops in order (school local times, HH:MM). */
export interface TransportRoute {
  vehicle: string | null;
  weekdays: number[];
  stops: {
    id: string;
    position: number;
    name: string;
    pickupTime: string;
    dropoffTime: string | null;
    active: boolean;
  }[];
}

/** A school's transport offerings with their routes and terms, for staff. */
export interface SchoolTransport {
  school: { id: SchoolId; name: string; timeZone: string };
  /** The viewer holds catalog.manage here. */
  canManage: boolean;
  offerings: {
    id: string;
    name: string;
    route: TransportRoute | null;
    terms: {
      sessionId: string;
      label: string | null;
      startsAt: string;
      endsAt: string | null;
      seats: number | null;
      taken: number;
      awaitingPayment: number;
    }[];
  }[];
}

/** The routes running on one day, with who boards at each stop (for the driver). */
export interface TransportRuns {
  date: string;
  routes: {
    sessionId: string;
    name: string;
    school: { id: SchoolId; name: string };
    term: string | null;
    vehicle: string | null;
    seats: number | null;
    riders: number;
    stops: {
      name: string;
      pickupTime: string;
      dropoffTime: string | null;
      children: { studentName: string | null; classLabel: string | null }[];
    }[];
  }[];
}

/** A school's uniforms for staff: stock per variant and paid items to hand over (ADR 0025). */
export interface SchoolUniforms {
  school: { id: SchoolId; name: string };
  /** catalog.manage: add variants and change stock. */
  canManage: boolean;
  /** bookings.manage: hand items over. */
  canHandOver: boolean;
  products: {
    id: string;
    name: string;
    variants: {
      id: string;
      sku: string;
      size: string | null;
      colour: string | null;
      price: { unitAmountMinor: number; currency: string } | null;
      onHand: number;
      reserved: number;
      allocated: number;
      free: number;
      lowStock: boolean;
      lowStockThreshold: number;
      active: boolean;
    }[];
  }[];
  awaitingHandOver: {
    reservationId: string;
    product: string;
    variant: string;
    quantity: number;
    studentName: string | null;
    classLabel: string | null;
    paidAt: string | null;
  }[];
}

export const REQUEST_KINDS = ['absence', 'dietary', 'collection', 'question', 'other'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export type RequestStatus = 'open' | 'in_progress' | 'answered' | 'closed';

/** A family's request to the school about a child, with its messages (M4.7). */
export interface FamilyRequest {
  id: string;
  school: { id: SchoolId; name: string };
  kind: RequestKind;
  subject: string;
  status: RequestStatus;
  createdAt: string;
  lastMessageAt: string;
  messages: {
    /** Written by the school's staff (families do not see staff names). */
    fromSchool: boolean;
    authorName: string | null;
    body: string;
    createdAt: string;
  }[];
}

/** A guardian's requests about one child, and the schools they can write to. */
export interface StudentRequests {
  student: { id: PersonId; givenName: string; familyName: string };
  schools: { id: SchoolId; name: string }[];
  requests: FamilyRequest[];
}

export interface OpenRequestBody {
  schoolId: string;
  kind: RequestKind;
  subject: string;
  message: string;
}

/** Requests at the schools where the viewer handles them; "active" is everything not closed. */
export interface SchoolRequests {
  filter: 'active' | RequestStatus;
  requests: (FamilyRequest & {
    studentName: string | null;
    classLabel: string | null;
    requestedBy: string | null;
  })[];
}

/** One school on one day for School Life: what every service needs doing (M4.8). A null part is not for the viewer. */
export interface SchoolLifeDay {
  school: { id: SchoolId; name: string; timeZone: string };
  date: string;
  /** Schools the viewer can switch to. */
  schools: { id: SchoolId; name: string }[];
  lunch: {
    meals: number;
    awaitingPayment: number;
    capacity: number | null;
    /** Dishes on the menu; 0 when it is not published. */
    dishes: number;
    showsDietary: boolean;
    alerts: {
      studentName: string | null;
      classLabel: string | null;
      kind: string;
      severity: string | null;
      description: string;
      /** Dishes on this child's lunch that contain their declared allergens. */
      onMenu: string[];
      verified: boolean;
    }[];
  } | null;
  /** Club meetings and booked lessons. */
  sessions: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    booked: number;
    /** Children marked attended or absent. */
    marked: number;
    canMark: boolean;
  }[];
  trips: {
    sessionId: string;
    name: string;
    startsAt: string;
    booked: number;
    capacity: number | null;
    withoutPermission: number;
  }[];
  transport: { name: string; riders: number; seats: number | null; firstPickup: string | null }[];
  uniforms: { awaitingHandOver: number; lowStock: number } | null;
  requests: { waiting: number; inProgress: number } | null;
  /** Current dietary needs at the school not yet verified; null if the viewer may not review them. */
  dietaryToVerify: number | null;
}

/** Admissions (M5, ADR 0026). Inquiries sent from a school's website. */
export const INQUIRY_OUTCOMES = [
  'applied',
  'not_interested',
  'no_response',
  'not_eligible',
  'duplicate',
] as const;
export type InquiryOutcome = (typeof INQUIRY_OUTCOMES)[number];
export const INQUIRY_NOTE_KINDS = ['note', 'call', 'email', 'meeting'] as const;
export type InquiryNoteKind = (typeof INQUIRY_NOTE_KINDS)[number];
export type InquiryStatus = 'new' | 'contacted' | 'closed';

/** What a website's inquiry form shows: the schools it serves and the current privacy notice. */
export interface InquiryForm {
  schools: { id: SchoolId; name: string }[];
  notice: { id: string; version: number; text: string; newsConsentText: string };
}

export interface InquiryRequestBody {
  host: string;
  schoolId: string;
  noticeId: string;
  parentName: string;
  email: string;
  phone?: string;
  childName?: string;
  birthYear?: number;
  gradeOfInterest?: string;
  intendedStart?: string;
  message?: string;
  newsConsent: boolean;
}

export interface Inquiry {
  id: string;
  school: { id: SchoolId; name: string };
  status: InquiryStatus;
  outcome: InquiryOutcome | null;
  /** Null once the inquiry has been erased. */
  parentName: string | null;
  email: string | null;
  phone: string | null;
  childName: string | null;
  birthYear: number | null;
  gradeOfInterest: string | null;
  intendedStart: string | null;
  message: string | null;
  /** The family agreed to news about open days, and has not withdrawn it. */
  newsConsent: boolean;
  noticeVersion: number;
  /** The sender was invited to apply and has a parent record (ADR 0027). */
  invited: boolean;
  receivedAt: string;
  lastActivityAt: string;
  notes: {
    kind: InquiryNoteKind | 'family_message';
    /** Null for a later form from the family. */
    author: string | null;
    body: string | null;
    createdAt: string;
  }[];
}

export interface SchoolInquiries {
  status: 'open' | 'closed' | 'all';
  inquiries: Inquiry[];
}

/** Admissions M5.2 (ADR 0027): intakes and applications. */
export type IntakeStatus = 'open' | 'closed';
export type ApplicationStatus =
  | 'submitted'
  | 'under_review'
  | 'waitlisted'
  | 'offered'
  | 'accepted'
  | 'enrolled'
  | 'declined'
  | 'expired'
  | 'rejected'
  | 'withdrawn';
export const APPLICATION_NOTE_KINDS = ['note', 'interview', 'assessment'] as const;
export type ApplicationNoteKind = (typeof APPLICATION_NOTE_KINDS)[number];

export interface Intake {
  id: string;
  school: { id: SchoolId; name: string };
  schoolYear: string;
  grade: string;
  places: number;
  opensOn: string;
  closesOn: string;
  status: IntakeStatus;
  /** Open and between its dates today, in the school's time zone. */
  takingApplications: boolean;
  /** The enrolment fee families pay once their child is enrolled (M5.8). */
  fee: { offeringId: string; name: string; amountMinor: number; currency: string } | null;
}

/** What a signed-in parent sees: open intakes, their children, their own applications. */
export interface FamilyAdmissions {
  intakes: Intake[];
  /** Children the parent may apply for (guardian with the consent capability). */
  children: { id: string; name: string }[];
  applications: {
    id: string;
    school: { id: SchoolId; name: string };
    intake: { id: string; schoolYear: string; grade: string };
    childName: string | null;
    status: ApplicationStatus;
    submittedAt: string;
    /** While an offer is open: the end of the day it must be answered by. */
    offerExpiresAt: string | null;
    /** On the waiting list: 1 for the next to be offered a place. */
    waitlistPosition: number | null;
    /** Once enrolled: the child's record, to book and pay for them. */
    studentId: string | null;
    /** Once enrolled from an intake with a fee: due, open (an order awaits payment) or paid. */
    fee: {
      offeringId: string;
      name: string;
      amountMinor: number;
      currency: string;
      state: 'due' | 'open' | 'paid';
    } | null;
  }[];
  notice: { id: string; version: number; text: string } | null;
}

export interface ApplicationRequestBody {
  intakeId: string;
  noticeId: string;
  /** One of the parent's children, or `child` for a child the group does not know yet. */
  studentId?: string;
  child?: { givenName: string; familyName: string; birthDate: string };
  currentSchool?: string;
  message?: string;
}

/** What admissions staff see at their schools. */
export interface SchoolApplications {
  schools: { id: SchoolId; name: string }[];
  /** Published fee offerings at those schools, to charge on an intake. */
  fees: { id: string; schoolId: SchoolId; name: string; amountMinor: number; currency: string }[];
  intakes: (Intake & {
    applications: {
      live: number;
      withdrawn: number;
      offered: number;
      accepted: number;
      enrolled: number;
      waitlisted: number;
    };
    /** Places not offered or accepted. */
    free: number;
  })[];
  applications: {
    id: string;
    school: { id: SchoolId; name: string };
    intake: { id: string; schoolYear: string; grade: string };
    status: ApplicationStatus;
    child: { name: string | null; birthDate: string | null; known: boolean; currentSchool: string | null };
    applicant: { name: string | null; email: string | null };
    message: string | null;
    noticeVersion: number;
    submittedAt: string;
    offerExpiresAt: string | null;
    waitlistPosition: number | null;
    /** Emptied on request or after the retention period (M5.6). */
    erased: boolean;
    /** Assessment and interview notes: admissions staff only. */
    notes: { kind: ApplicationNoteKind; author: string | null; body: string | null; createdAt: string }[];
  }[];
}

export const GUARDIAN_RELATIONSHIPS = [
  'mother',
  'father',
  'parent',
  'legal_guardian',
  'foster_carer',
  'other',
] as const;
export type GuardianRelationshipKind = (typeof GUARDIAN_RELATIONSHIPS)[number];

/** Staff enrol an accepted application (M5.4). The relationship is needed for a child new to the group. */
export interface EnrolRequestBody {
  startDate: string;
  classLabel?: string;
  relationship?: GuardianRelationshipKind;
}

export interface IntakeRequestBody {
  schoolId: string;
  schoolYear: string;
  grade: string;
  places: number;
  opensOn: string;
  closesOn: string;
}

/** The admissions pipeline in numbers (M5.5): per school, intake and source, without personal data. */
export interface AdmissionsPipeline {
  since: string | null;
  intakes: {
    id: string;
    school: { id: SchoolId; name: string };
    schoolYear: string;
    grade: string;
    places: number;
    status: IntakeStatus;
    /** Places not offered, accepted or enrolled. */
    free: number;
    counts: Record<ApplicationStatus, number>;
    /** Applications from parents invited after an inquiry to the school. */
    fromInquiry: number;
  }[];
  inquiries: {
    school: { id: SchoolId; name: string };
    website: { id: string; name: string };
    received: number;
    waiting: number;
    contacted: number;
    closed: number;
    applied: number;
    invited: number;
  }[];
  /** What needs doing next, for admissions staff; null for those who see numbers only. */
  followUps:
    | {
        kind: 'inquiry_waiting' | 'application_waiting' | 'offer_ending' | 'to_enrol';
        school: { id: SchoolId; name: string };
        label: string | null;
        /** When it started waiting, or when the offer ends. */
        at: string;
        href: string;
      }[]
    | null;
}
