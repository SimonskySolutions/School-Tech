import { type MyApprovals, type SchoolDocuments } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, post, tokenFor } from './helpers';

// Approvals of document versions (M6.5) against the real stack: a School A
// policy approved by its principal, then the CEO; a new version needs its own
// approval; a rejection says why; a request is withdrawn.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const tokens: Record<string, string> = {};

const PDF = (text: string) => new Uint8Array(Buffer.from(`%PDF-1.7\n% ${text} (synthetic)\n`));
const upload = (documentId: string, text: string) =>
  fetch(`${API}/documents/${documentId}/file`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${tokens['principal.a']}`,
      'content-type': 'application/pdf',
      'x-file-name': `${text}.pdf`,
    },
    body: PDF(text),
  });
const documentAtA = async (user: string, id: string) =>
  (await get<SchoolDocuments>(`/schools/${SCHOOL_A}/documents`, tokens[user]!)).body.documents.find(
    (document) => document.id === id,
  )!;
const waiting = async (user: string) =>
  (await get<MyApprovals>('/documents/approvals/waiting', tokens[user]!)).body.waiting;
const decide = (user: string, stepId: string, body: unknown) =>
  post<{ outcome: string }>(tokens[user]!, `/documents/approval-steps/${stepId}/decision`, body);
const ask = (versionId: string, steps: string[]) =>
  post<{ id: string }>(tokens['principal.a']!, `/documents/versions/${versionId}/approvals`, { steps });

let policyId: string;

beforeAll(async () => {
  for (const user of ['principal.a', 'kitchen.a', 'teacher.b', 'ceo']) tokens[user] = await tokenFor(user);
  policyId = (
    await post<{ id: string }>(tokens['principal.a']!, '/documents', {
      attachedTo: 'school',
      schoolId: SCHOOL_A,
      title: 'Behaviour policy (approvals test)',
      category: 'policy',
      forAllStaff: true,
    })
  ).body.id;
  expect((await upload(policyId, 'first')).status).toBe(201);
});

describe('approvals', () => {
  it('go step by step: the principal, then the CEO', async () => {
    const v1 = (await documentAtA('principal.a', policyId)).versions[0]!;
    expect(v1.approval).toBeNull();
    expect((await ask(v1.id, ['principal', 'group_ceo'])).status).toBe(201);
    expect((await ask(v1.id, ['group_ceo'])).status).toBe(409);

    const mine = (await waiting('principal.a')).find((step) => step.documentId === policyId)!;
    expect(mine).toMatchObject({ stepNo: 1, role: 'principal', schoolName: 'School A', versionNo: 1 });
    expect((await waiting('ceo')).some((step) => step.documentId === policyId)).toBe(false);
    const ceoStep = mine.steps[1]!.id;
    expect((await decide('ceo', ceoStep, { decision: 'approved' })).status).toBe(409);
    expect((await decide('teacher.b', mine.stepId, { decision: 'approved' })).status).toBe(404);
    expect((await decide('principal.a', mine.stepId, { decision: 'approved' })).body).toEqual({
      outcome: 'pending',
    });

    const theirs = (await waiting('ceo')).find((step) => step.documentId === policyId)!;
    expect(theirs.stepId).toBe(ceoStep);
    expect(theirs.steps[0]).toMatchObject({
      status: 'approved',
      decidedBy: 'Petar Nikolov',
      mayDecide: false,
    });
    expect((await decide('ceo', ceoStep, { decision: 'rejected' })).status).toBe(400);
    expect(
      (await decide('ceo', ceoStep, { decision: 'approved', note: 'Agreed (synthetic).' })).body,
    ).toEqual({
      outcome: 'approved',
    });

    const seen = (await documentAtA('kitchen.a', policyId)).versions[0]!.approval!;
    expect(seen.status).toBe('approved');
    expect(seen.steps.map((step) => [step.role, step.status, step.mayDecide])).toEqual([
      ['principal', 'approved', false],
      ['group_ceo', 'approved', false],
    ]);
    expect(seen.steps[1]!.note).toBe('Agreed (synthetic).');
  });

  it('asks again for a new version, and a rejection says why', async () => {
    expect((await upload(policyId, 'second')).status).toBe(201);
    const [v2, v1] = (await documentAtA('principal.a', policyId)).versions;
    expect(v1!.approval!.status).toBe('approved');
    expect(v2!.approval).toBeNull();
    expect((await ask(v1!.id, ['principal'])).status).toBe(409);

    expect((await ask(v2!.id, ['principal'])).status).toBe(201);
    const step = (await waiting('principal.a')).find((entry) => entry.versionId === v2!.id)!;
    expect(
      (await decide('principal.a', step.stepId, { decision: 'rejected', note: 'Section 3 is out of date.' }))
        .body,
    ).toEqual({ outcome: 'rejected' });
    const rejected = (await documentAtA('principal.a', policyId)).versions[0]!.approval!;
    expect(rejected).toMatchObject({ status: 'rejected' });
    expect(rejected.steps[0]!.note).toBe('Section 3 is out of date.');

    const again = await ask(v2!.id, ['principal', 'group_ceo']);
    expect(again.status).toBe(201);
    expect((await post(tokens['kitchen.a']!, `/documents/approvals/${again.body.id}/withdraw`)).status).toBe(
      404,
    );
    expect(
      (await post(tokens['principal.a']!, `/documents/approvals/${again.body.id}/withdraw`)).status,
    ).toBe(200);
    expect(
      (await post(tokens['principal.a']!, `/documents/approvals/${again.body.id}/withdraw`)).status,
    ).toBe(409);
    expect((await documentAtA('principal.a', policyId)).versions[0]!.approval!.status).toBe('withdrawn');
  });

  it('lets only group roles approve a member of staff’s document', async () => {
    const contract = (
      await post<{ id: string }>(tokens['principal.a']!, '/documents', {
        attachedTo: 'staff',
        personId: KITCHEN_A,
        title: 'Contract (approvals test)',
        category: 'contract',
      })
    ).body.id;
    expect((await upload(contract, 'contract')).status).toBe(201);
    const version = (await documentAtA('principal.a', contract)).versions[0]!;
    expect((await ask(version.id, ['principal'])).status).toBe(422);
    expect((await ask(version.id, ['teacher'])).status).toBe(400);
    expect((await ask(version.id, ['group_ceo'])).status).toBe(201);
  });
});
