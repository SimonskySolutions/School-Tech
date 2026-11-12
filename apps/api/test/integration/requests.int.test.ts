import { type SchoolRequests, type StudentRequests } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { BORIS, get, MILA, post, tokenFor } from './helpers';

// Parent requests (M4.7) against the real stack. The seed has Anna's open
// request to School A about who collects Mila on Friday. Anna writes about an
// absence; School Life and the principal of School A see it, others do not;
// the conversation goes from open to closed.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const SCHOOL_C = 'b1000000-0000-7000-8000-00000000000c';

const tokens: Record<string, string> = {};
const mine = async () =>
  (await get<StudentRequests>(`/students/${MILA}/requests`, tokens['anna.ivanova']!)).body;
const staffList = async (user: string, status = 'active') =>
  get<SchoolRequests>(`/school-life/requests?status=${status}`, tokens[user]!);
let requestId: string;

beforeAll(async () => {
  for (const user of [
    'anna.ivanova',
    'hristo.georgiev',
    'schoollife',
    'principal.a',
    'principal.c',
    'kitchen.a',
    'ceo',
  ]) {
    tokens[user] = await tokenFor(user);
  }
});

describe('a family writes to the school', () => {
  it("shows Anna Mila's school and her open request about Friday", async () => {
    const mila = await mine();
    expect(mila.schools).toEqual([{ id: SCHOOL_A, name: 'School A' }]);
    expect(mila.requests).toContainEqual(
      expect.objectContaining({
        kind: 'collection',
        status: 'open',
        subject: 'Grandmother collects Mila on Friday (synthetic)',
      }),
    );
  });

  it('opens a request to the child’s school only, and only for her own child', async () => {
    const request = {
      schoolId: SCHOOL_A,
      kind: 'absence',
      subject: 'Mila at the dentist on Monday (integration test)',
      message: 'Mila will come in at 11:00 after a dentist appointment.',
    };
    expect(
      (await post(tokens['anna.ivanova']!, `/students/${MILA}/requests`, { ...request, schoolId: SCHOOL_C }))
        .status,
    ).toBe(422);
    expect((await post(tokens['hristo.georgiev']!, `/students/${MILA}/requests`, request)).status).toBe(404);
    expect(
      (await post(tokens['anna.ivanova']!, `/students/${MILA}/requests`, { ...request, kind: 'gossip' }))
        .status,
    ).toBe(400);
    const opened = await post<{ requestId: string }>(
      tokens['anna.ivanova']!,
      `/students/${MILA}/requests`,
      request,
    );
    expect(opened.status).toBe(201);
    requestId = opened.body.requestId;
    expect((await get(`/students/${BORIS}/requests`, tokens['hristo.georgiev']!)).status).toBe(404);
  });
});

describe('School Life answers', () => {
  it('reaches School Life and the School A principal, not other schools, the kitchen or the CEO', async () => {
    const forSchoolLife = (await staffList('schoollife')).body.requests.find((r) => r.id === requestId)!;
    expect(forSchoolLife).toMatchObject({
      studentName: 'Mila Ivanova',
      classLabel: '3A',
      requestedBy: 'Anna Ivanova',
      status: 'open',
      school: { name: 'School A' },
    });
    expect(forSchoolLife.messages).toEqual([
      expect.objectContaining({
        fromSchool: false,
        body: 'Mila will come in at 11:00 after a dentist appointment.',
      }),
    ]);
    expect((await staffList('principal.a')).body.requests.map((r) => r.id)).toContain(requestId);
    expect((await staffList('principal.c')).body.requests.map((r) => r.id)).not.toContain(requestId);
    expect((await staffList('kitchen.a')).status).toBe(403);
    expect((await staffList('ceo')).status).toBe(403);
  });

  it('goes from open to in progress to answered, back to open on the family’s reply, then closed', async () => {
    expect(
      (
        await post(tokens['principal.c']!, `/school-life/requests/${requestId}/status`, {
          status: 'in_progress',
        })
      ).status,
    ).toBe(404);
    const taken = await post<{ status: string }>(
      tokens['principal.a']!,
      `/school-life/requests/${requestId}/status`,
      {
        status: 'in_progress',
      },
    );
    expect(taken.body.status).toBe('in_progress');
    const answered = await post<{ status: string }>(
      tokens.schoollife!,
      `/school-life/requests/${requestId}/messages`,
      {
        message: 'Thank you, the class teacher knows.',
      },
    );
    expect(answered.body.status).toBe('answered');

    const seen = (await mine()).requests.find((r) => r.id === requestId)!;
    expect(seen.status).toBe('answered');
    expect(seen.messages.at(-1)).toMatchObject({
      fromSchool: true,
      body: 'Thank you, the class teacher knows.',
    });

    const reopened = await post<{ status: string }>(
      tokens['anna.ivanova']!,
      `/students/${MILA}/requests/${requestId}/messages`,
      {
        message: 'She will bring a note from the dentist.',
      },
    );
    expect(reopened.body.status).toBe('open');
    expect(
      (
        await post(tokens['anna.ivanova']!, `/school-life/requests/${requestId}/status`, {
          status: 'in_progress',
        })
      ).status,
    ).toBe(403);
    const closed = await post<{ status: string }>(
      tokens['anna.ivanova']!,
      `/students/${MILA}/requests/${requestId}/close`,
    );
    expect(closed.body.status).toBe('closed');
    expect(
      (
        await post(tokens['anna.ivanova']!, `/students/${MILA}/requests/${requestId}/messages`, {
          message: 'One more',
        })
      ).status,
    ).toBe(409);
    expect((await staffList('schoollife', 'closed')).body.requests.map((r) => r.id)).toContain(requestId);
    expect((await staffList('schoollife')).body.requests.map((r) => r.id)).not.toContain(requestId);
  });
});
