import { type DownloadLink, type MyStaffRecords, type SchoolDocuments } from '@pythagoras/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, get, MILA, post, secret, tokenFor } from './helpers';

// Private documents (M6.4, ADR 0029) against the real stack, Garage included.
// The principal of School A files a policy for all staff, the kitchen's
// contract and a report on Mila; downloads go through single-use links that
// only the person who asked may use, and each one is in the access log.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const CEO = 'c1000000-0000-7000-8000-000000000001';
const PDF = (text: string) => Buffer.from(`%PDF-1.7\n% ${text} (synthetic)\n%%EOF\n`);

const tokens: Record<string, string> = {};
let auditor: Client;
const since = new Date();

const upload = (
  user: string,
  documentId: string,
  bytes: Buffer,
  type = 'application/pdf',
  name = 'policy.pdf',
) =>
  fetch(`${API}/documents/${documentId}/file`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${tokens[user]}`,
      'content-type': type,
      'x-file-name': encodeURIComponent(name),
    },
    body: new Uint8Array(bytes),
  });
const file = (user: string, title: string) =>
  post<{ id: string }>(tokens[user]!, '/documents', {
    attachedTo: 'school',
    schoolId: SCHOOL_A,
    title,
    category: 'policy',
    forAllStaff: true,
  });
const link = (user: string, versionId: string) =>
  post<DownloadLink>(tokens[user]!, `/documents/versions/${versionId}/links`);
const download = (user: string, token: string) =>
  fetch(`${API}/documents/files/${token}`, { headers: { authorization: `Bearer ${tokens[user]}` } });
const documentsAtA = (user: string) => get<SchoolDocuments>(`/schools/${SCHOOL_A}/documents`, tokens[user]!);

async function downloads(actor: string, resource: string): Promise<number> {
  await auditor.query('BEGIN');
  try {
    await auditor.query(`SELECT set_config('app.person_id', $1, true)`, [CEO]);
    const { rows } = await auditor.query<{ n: string }>(
      `SELECT count(*) AS n FROM audit.access_log
        WHERE actor_person_id = $1 AND action = 'download' AND resource = $2 AND occurred_at >= $3`,
      [actor, resource, since],
    );
    return Number(rows[0]!.n);
  } finally {
    await auditor.query('ROLLBACK');
  }
}

beforeAll(async () => {
  for (const user of ['principal.a', 'principal.b', 'kitchen.a', 'teacher.b', 'anna.ivanova', 'ceo']) {
    tokens[user] = await tokenFor(user);
  }
  auditor = new Client({
    host: 'postgres',
    database: 'pythagoras',
    user: 'pyth_api',
    password: secret('pg_api_password'),
  });
  await auditor.connect();
});
afterAll(() => auditor.end());

describe('private documents', () => {
  it('keeps each version of a school document, for its staff only', async () => {
    const created = await file('principal.a', 'Safeguarding policy (integration test)');
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await upload('principal.a', id, PDF('first'))).status).toBe(201);
    const second = await upload('principal.a', id, PDF('second'), 'application/pdf', '../Policy 2026.pdf');
    expect(second.status).toBe(201);
    expect(await second.json()).toMatchObject({ versionNo: 2, fileName: 'Policy 2026.pdf' });

    const kitchen = await documentsAtA('kitchen.a');
    expect(kitchen.status).toBe(200);
    expect(kitchen.body.canManage).toBe(false);
    const policy = kitchen.body.documents.find((document) => document.id === id)!;
    expect(policy.versions.map((version) => version.versionNo)).toEqual([2, 1]);
    expect(policy.versions[0]).toMatchObject({ fileName: 'Policy 2026.pdf', contentType: 'application/pdf' });
    expect((await documentsAtA('teacher.b')).status).toBe(404);
    expect((await documentsAtA('anna.ivanova')).status).toBe(404);
    expect((await documentsAtA('principal.b')).status).toBe(404);
  });

  it('refuses what is not allowed in', async () => {
    const id = (await file('principal.a', 'Refusals (integration test)')).body.id;
    expect((await upload('principal.a', id, Buffer.from('<html>'), 'text/html', 'x.html')).status).toBe(415);
    expect((await upload('principal.a', id, Buffer.from('<html>'), 'application/pdf')).status).toBe(422);
    expect((await upload('principal.a', id, Buffer.alloc(0))).status).toBe(422);
    expect(
      (await upload('principal.a', id, Buffer.concat([PDF('big'), Buffer.alloc(10 * 1024 * 1024)]))).status,
    ).toBe(413);
    expect((await upload('kitchen.a', id, PDF('kitchen'))).status).toBe(404);
    expect(
      (await documentsAtA('principal.a')).body.documents.find((document) => document.id === id)!.versions,
    ).toEqual([]);
  });

  it('downloads only through a link the reader asked for, once', async () => {
    const policy = (await documentsAtA('kitchen.a')).body.documents.find(
      (document) => document.title === 'Safeguarding policy (integration test)',
    )!;
    const issued = await link('kitchen.a', policy.versions[0]!.id);
    expect(issued.status).toBe(201);
    expect(new Date(issued.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(120_000);
    expect((await download('principal.a', issued.body.token)).status).toBe(404);

    const response = await download('kitchen.a', issued.body.token);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="Policy 2026.pdf"; filename*=UTF-8''Policy%202026.pdf`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF('second'));
    expect((await download('kitchen.a', issued.body.token)).status).toBe(404);
    expect((await download('kitchen.a', 'x'.repeat(43))).status).toBe(404);
    expect(await downloads(KITCHEN_A, 'documents.version:school')).toBe(1);
  });

  it('files a member of staff’s documents with them, and a pupil’s with the school', async () => {
    const contract = await post<{ id: string }>(tokens['principal.a']!, '/documents', {
      attachedTo: 'staff',
      personId: KITCHEN_A,
      title: 'Contract (integration test)',
      category: 'contract',
    });
    expect(contract.status).toBe(201);
    expect(
      (await upload('principal.a', contract.body.id, PDF('contract'), 'application/pdf', 'contract.pdf'))
        .status,
    ).toBe(201);
    const report = await post<{ id: string }>(tokens['principal.a']!, '/documents', {
      attachedTo: 'student',
      schoolId: SCHOOL_A,
      personId: MILA,
      title: 'Report (integration test)',
      category: 'report',
    });
    expect(report.status).toBe(201);
    expect(
      (
        await upload(
          'principal.a',
          report.body.id,
          Buffer.from('Progress: good (synthetic).'),
          'text/plain',
          'report',
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await post(tokens['principal.b']!, '/documents', {
          attachedTo: 'staff',
          personId: KITCHEN_A,
          title: 'x',
          category: 'contract',
        })
      ).status,
    ).toBe(404);

    // Other files may also file documents for this person (the approvals test does).
    const mine = (await get<MyStaffRecords>('/staff/me', tokens['kitchen.a']!)).body.documents;
    const contractOfMine = mine.find((document) => document.title === 'Contract (integration test)');
    expect(contractOfMine).toBeDefined();
    const own = await link('kitchen.a', contractOfMine!.versions[0]!.id);
    expect((await download('kitchen.a', own.body.token)).status).toBe(200);

    const principal = (await documentsAtA('principal.a')).body;
    expect(principal.canManage).toBe(true);
    expect(principal.students.map((student) => student.personId)).toContain(MILA);
    const pupil = principal.documents.find((document) => document.id === report.body.id)!;
    expect(pupil).toMatchObject({ attachedTo: 'student', personName: 'Mila Ivanova' });
    expect(pupil.versions[0]!.fileName).toBe('report.txt');
    expect((await link('kitchen.a', pupil.versions[0]!.id)).status).toBe(404);
    expect((await link('anna.ivanova', pupil.versions[0]!.id)).status).toBe(404);
    const ceo = await link('ceo', pupil.versions[0]!.id);
    expect(await (await download('ceo', ceo.body.token)).text()).toBe('Progress: good (synthetic).');
  });

  it('archives a document instead of deleting it', async () => {
    const id = (await file('principal.a', 'Old plan (integration test)')).body.id;
    expect((await post(tokens['kitchen.a']!, `/documents/${id}/archive`)).status).toBe(404);
    expect((await post(tokens['principal.a']!, `/documents/${id}/archive`)).status).toBe(200);
    expect((await post(tokens['principal.a']!, `/documents/${id}/archive`)).status).toBe(409);
    expect((await upload('principal.a', id, PDF('late'))).status).toBe(409);
    const archived = (await documentsAtA('principal.a')).body.documents.find(
      (document) => document.id === id,
    )!;
    expect(archived.archivedAt).not.toBeNull();
  });
});
