import { type ActivityRegisters, type SchoolSetup, type StudentActivities } from '@pythagoras/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  BORIS,
  get,
  MILA,
  offeringsOf,
  payAndWait,
  placeOrder,
  post,
  secret,
  tokenFor,
} from './helpers';

// Activity eligibility and attendance (M4.2) against the real stack. In the
// seed Mila (grade 3, School A) may take chess (grades 2-7) but not debate
// (grades 5-7); Boris (6) may take robotics (ages 5-10). Anna buys chess for
// Mila; one meeting is then moved to an hour ago so it can be marked.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const DEBATE = 'd2000000-0000-7000-8000-0000000000a5';
const ADMIN = 'c1000000-0000-7000-8000-000000000002';

const tokens: Record<string, string> = {};
let admin: Client;
let moved: { id: string; startsAt: Date; endsAt: Date | null; cutoff: Date | null } | null = null;

async function send<T>(method: string, user: string, path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[user]}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T & { message?: string } };
}

/** As the group administrator through the API role, as the set-up pages would. */
async function asAdmin<T>(sql: string, params: unknown[]): Promise<T[]> {
  await admin.query('BEGIN');
  try {
    await admin.query(`SELECT set_config('app.person_id', $1, true)`, [ADMIN]);
    const { rows } = await admin.query(sql, params);
    await admin.query('COMMIT');
    return rows as T[];
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'admin', 'principal.a', 'kitchen.a', 'schoollife', 'teacher.b']) {
    tokens[user] = await tokenFor(user);
  }
  admin = new Client({
    host: 'postgres',
    database: 'pythagoras',
    user: 'pyth_api',
    password: secret('pg_api_password'),
  });
  await admin.connect();
});

afterAll(async () => {
  if (moved) {
    await asAdmin(
      'UPDATE scheduling.session SET starts_at = $2, ends_at = $3, booking_cutoff_at = $4 WHERE id = $1',
      [moved.id, moved.startsAt, moved.endsAt, moved.cutoff],
    );
  }
  await send('PUT', 'admin', `/admin/schools/${SCHOOL_A}/offerings/${DEBATE}/eligibility`, {
    grades: ['5', '6', '7'],
  });
  await admin?.end();
});

describe('eligibility', () => {
  it('tells Anna which clubs Mila and Boris may take, and why not', async () => {
    const { body } = await get<{
      offerings: { id: string; name: string; eligibility: { problem: string | null } }[];
    }>(`/students/${MILA}/offerings`, tokens['anna.ivanova']!);
    const debate = body.offerings.find((offering) => offering.id === DEBATE)!;
    expect(debate.eligibility).toEqual({
      rules: { grades: ['5', '6', '7'] },
      problem: 'for grades 5, 6, 7 only',
    });
    const chess = body.offerings.find((offering) => offering.name === 'Chess club, School A')!;
    expect(chess.eligibility.problem).toBeNull();
    const boris = await offeringsOf(tokens['anna.ivanova']!, BORIS);
    expect(boris.activity.eligibility).toEqual({ rules: { minAge: 5, maxAge: 10 }, problem: null });
  });

  it('refuses to book Mila on the debate club, saying why', async () => {
    const response = await fetch(`${API}/checkout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens['anna.ivanova']}`,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ items: [{ studentId: MILA, offeringId: DEBATE }] }),
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { message: string }).message).toBe(
      'Mila cannot take Debate club, School A: for grades 5, 6, 7 only',
    );
  });

  it('lets the group administrator change who may take a club, and shows it on the set-up page', async () => {
    expect(
      (
        await send('PUT', 'admin', `/admin/schools/${SCHOOL_A}/offerings/${DEBATE}/eligibility`, {
          minAge: 9,
          maxAge: 7,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send('PUT', 'principal.a', `/admin/schools/${SCHOOL_A}/offerings/${DEBATE}/eligibility`, {
          grades: ['3'],
        })
      ).status,
    ).toBe(403);
    const changed = await send('PUT', 'admin', `/admin/schools/${SCHOOL_A}/offerings/${DEBATE}/eligibility`, {
      grades: ['3', '5'],
    });
    expect(changed.status).toBe(200);
    expect(changed.body).toEqual({ offeringId: DEBATE, eligibility: { grades: ['3', '5'] } });

    const setup = (await get<SchoolSetup>(`/admin/schools/${SCHOOL_A}`, tokens.admin!)).body;
    expect(setup.offerings.find((offering) => offering.id === DEBATE)!.eligibility).toEqual({
      grades: ['3', '5'],
    });
    const { body } = await get<{ offerings: { id: string; eligibility: { problem: string | null } }[] }>(
      `/students/${MILA}/offerings`,
      tokens['anna.ivanova']!,
    );
    expect(body.offerings.find((offering) => offering.id === DEBATE)!.eligibility.problem).toBeNull();
  });
});

describe('attendance', () => {
  let bookingId: string;
  let day: string;

  beforeAll(async () => {
    const mila = await offeringsOf(tokens['anna.ivanova']!, MILA);
    if (!mila.activity.sessions.some((session) => session.alreadyBooked)) {
      const anna = tokens['anna.ivanova']!;
      await payAndWait(anna, await placeOrder(anna, [{ studentId: MILA, offeringId: mila.activity.id }]));
    }
    // Move Mila's first booked chess meeting to an hour ago.
    const [session] = await asAdmin<{
      id: string;
      starts_at: Date;
      ends_at: Date | null;
      booking_cutoff_at: Date | null;
    }>(
      `SELECT s.id, s.starts_at, s.ends_at, s.booking_cutoff_at FROM scheduling.session s
         JOIN scheduling.booking b ON b.session_id = s.id
        WHERE b.student_person_id = $1 AND s.offering_id = $2 AND b.status = 'confirmed'
        ORDER BY s.starts_at LIMIT 1`,
      [MILA, mila.activity.id],
    );
    moved = {
      id: session!.id,
      startsAt: session!.starts_at,
      endsAt: session!.ends_at,
      cutoff: session!.booking_cutoff_at,
    };
    const [now] = await asAdmin<{ day: string }>(
      `UPDATE scheduling.session
          SET starts_at = now() - interval '1 hour', ends_at = now(), booking_cutoff_at = now() - interval '25 hours'
        WHERE id = $1
       RETURNING to_char((starts_at AT TIME ZONE 'Europe/Sofia')::date, 'YYYY-MM-DD') AS day`,
      [session!.id],
    );
    day = now!.day;
    const registers = (
      await get<ActivityRegisters>(`/school-life/registers?from=${day}&days=1`, tokens.schoollife!)
    ).body;
    bookingId = registers.sessions
      .find((entry) => entry.id === session!.id)!
      .attendees.find((attendee) => attendee.studentName === 'Mila Ivanova')!.bookingId;
  });

  it('opens the register for marking only once the meeting has started, for staff who may mark', async () => {
    const forSchoolLife = (
      await get<ActivityRegisters>(`/school-life/registers?from=${day}&days=1`, tokens.schoollife!)
    ).body;
    expect(forSchoolLife.sessions.find((entry) => entry.id === moved!.id)!.canMark).toBe(true);
    const forKitchen = (
      await get<ActivityRegisters>(`/school-life/registers?from=${day}&days=1`, tokens['kitchen.a']!)
    ).body;
    expect(forKitchen.sessions.find((entry) => entry.id === moved!.id)!.canMark).toBe(false);
    const later = (await get<ActivityRegisters>(`/school-life/registers?days=31`, tokens.schoollife!)).body;
    expect(later.sessions.filter((entry) => entry.id !== moved!.id).every((entry) => !entry.canMark)).toBe(
      true,
    );
  });

  it('lets the principal mark Mila attended, and refuses everyone else', async () => {
    const path = `/school-life/bookings/${bookingId}/attendance`;
    expect((await post(tokens['kitchen.a']!, path, { status: 'attended' })).status).toBe(403);
    expect((await post(tokens['teacher.b']!, path, { status: 'attended' })).status).toBe(404);
    expect((await post(tokens['anna.ivanova']!, path, { status: 'attended' })).status).toBe(404);
    expect((await post(tokens['principal.a']!, path, { status: 'present' })).status).toBe(400);
    const marked = await post<{ status: string }>(tokens['principal.a']!, path, { status: 'attended' });
    expect(marked.status).toBe(200);
    expect(marked.body.status).toBe('attended');
  });

  it('refuses to mark a meeting that has not started', async () => {
    const registers = (await get<ActivityRegisters>(`/school-life/registers?days=31`, tokens.schoollife!))
      .body;
    const future = registers.sessions
      .filter((entry) => entry.id !== moved!.id)
      .flatMap((entry) => entry.attendees)
      .find((attendee) => attendee.studentName === 'Mila Ivanova')!;
    expect(
      (
        await post(tokens.schoollife!, `/school-life/bookings/${future.bookingId}/attendance`, {
          status: 'absent',
        })
      ).status,
    ).toBe(409);
  });

  it("shows Anna Mila's attendance, and nobody else's children", async () => {
    const mila = (await get<StudentActivities>(`/students/${MILA}/activities`, tokens['anna.ivanova']!)).body;
    expect(mila.student.givenName).toBe('Mila');
    expect(mila.sessions[0]).toMatchObject({ offeringName: 'Chess club, School A', status: 'attended' });
    expect(mila.sessions.slice(1).every((session) => session.status === 'confirmed')).toBe(true);
    const hristo = await tokenFor('hristo.georgiev');
    expect((await get(`/students/${MILA}/activities`, hristo)).status).toBe(404);
  });
});
