import { type AdmissionsPipeline } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, tokenFor } from './helpers';

// The admissions pipeline (M5.5) against the real stack: the numbers for the
// school's admissions staff and the CEO, follow-ups for staff only, nothing
// for anyone else. The seed has Lora Petkova's inquiry and the grade 1 intake
// at School A.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const INTAKE = 'db000000-0000-7000-8000-0000000000a1';

const tokens: Record<string, string> = {};
const pipeline = (user: string, query = '') =>
  get<AdmissionsPipeline>(`/admissions/pipeline${query}`, tokens[user]!);

beforeAll(async () => {
  for (const user of ['principal.a', 'principal.c', 'ceo', 'schoollife', 'finance', 'anna.ivanova']) {
    tokens[user] = await tokenFor(user);
  }
});

describe('admissions in numbers', () => {
  it('shows the principal of School A the intake and the inquiries, with follow-ups', async () => {
    const { status, body } = await pipeline('principal.a');
    expect(status).toBe(200);
    expect(body.intakes.find((intake) => intake.id === INTAKE)).toMatchObject({
      school: { id: SCHOOL_A, name: 'School A' },
      places: 20,
    });
    expect(body.intakes.every((intake) => intake.school.id === SCHOOL_A)).toBe(true);
    expect(body.inquiries.find((row) => row.school.id === SCHOOL_A)!.received).toBeGreaterThan(0);
    expect(Array.isArray(body.followUps)).toBe(true);
  });

  it('shows the CEO every school’s numbers and no names', async () => {
    const { status, body } = await pipeline('ceo');
    expect(status).toBe(200);
    expect(body.followUps).toBeNull();
    expect(body.intakes.some((intake) => intake.id === INTAKE)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('Lora');
    expect(JSON.stringify(body)).not.toContain('@');
    expect((await get('/admissions/inquiries', tokens.ceo!)).status).toBe(403);
  });

  it('shows another school’s principal only their own school, and others nothing', async () => {
    const other = (await pipeline('principal.c')).body;
    expect(other.intakes.some((intake) => intake.school.id === SCHOOL_A)).toBe(false);
    expect(other.inquiries.some((row) => row.school.id === SCHOOL_A)).toBe(false);
    for (const user of ['schoollife', 'finance', 'anna.ivanova'])
      expect((await pipeline(user)).status).toBe(403);
    expect((await pipeline('principal.a', '?since=yesterday')).status).toBe(400);
  });
});
