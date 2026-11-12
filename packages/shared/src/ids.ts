// Identifiers are UUIDs (version 7 from the database, ADR 0007). The brand
// keeps, for example, a person id from being passed where a school id is
// expected without an explicit conversion.

declare const brand: unique symbol;
export type Id<Kind extends string> = string & { readonly [brand]: Kind };

export type PersonId = Id<'person'>;
export type SchoolId = Id<'school'>;
export type GroupId = Id<'group'>;
export type LegalEntityId = Id<'legal_entity'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Validates an untrusted string (URL segment, request body) as an id of the given kind. */
export function parseId<Kind extends string>(value: unknown, kind: Kind): Id<Kind> {
  if (!isUuid(value)) {
    throw new TypeError(`invalid ${kind} id`);
  }
  return value as Id<Kind>;
}
