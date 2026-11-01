import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { describeUpload, documentSchema, readUpload } from './documents.controller';
import { DocumentRejected } from './documents.repository';
import { cleanFileName, contentDisposition, looksLike, newToken, TOKEN, tokenHash } from './files';

const zipStart = (name: string, content = '') => {
  const header = Buffer.alloc(30);
  header.write('PK\u0003\u0004', 0, 'latin1');
  return Buffer.concat([header, Buffer.from(name + content, 'latin1')]);
};

describe('uploaded files', () => {
  it('must start the way their type says', () => {
    expect(looksLike('application/pdf', Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(looksLike('application/pdf', Buffer.from('<html>'))).toBe(false);
    expect(looksLike('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      true,
    );
    expect(looksLike('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLike('image/jpeg', Buffer.from('%PDF-'))).toBe(false);
    expect(looksLike('text/plain', Buffer.from('Учебен план, синтетичен'))).toBe(true);
    expect(looksLike('text/plain', Buffer.from([0x41, 0, 0x42]))).toBe(false);
    expect(looksLike('text/plain', Buffer.from([0xc3, 0x28]))).toBe(false);
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(looksLike(docx, zipStart('[Content_Types].xml'))).toBe(true);
    expect(looksLike(docx, Buffer.from('MZ'))).toBe(false);
    const odt = 'application/vnd.oasis.opendocument.text';
    expect(looksLike(odt, zipStart('mimetype', odt))).toBe(true);
    expect(looksLike(odt, zipStart('mimetype', 'application/vnd.oasis.opendocument.spreadsheet'))).toBe(
      false,
    );
  });

  it('keep only a clean name ending in their extension', () => {
    expect(cleanFileName('C:\\Users\\x\\Policy 2026.PDF', 'application/pdf')).toBe('Policy 2026.PDF');
    expect(cleanFileName('../../etc/passwd', 'text/plain')).toBe('passwd.txt');
    expect(
      cleanFileName(
        'report\u0000\u001b.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe('report.docx');
    expect(cleanFileName('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
    expect(cleanFileName('', 'application/pdf')).toBe('document.pdf');
    expect(cleanFileName('..', 'application/pdf')).toBe('document.pdf');
    expect(cleanFileName('invoice.pdf.exe', 'application/pdf')).toBe('invoice.pdf.exe.pdf');
    const long = cleanFileName(`${'x'.repeat(300)}.pdf`, 'application/pdf');
    expect(long).toHaveLength(200);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('go back out as attachments whatever their name', () => {
    expect(contentDisposition('План "2026".pdf')).toBe(
      `attachment; filename="____ _2026_.pdf"; filename*=UTF-8''${encodeURIComponent('План "2026".pdf')}`,
    );
  });

  it('declare a listed type and a percent-encoded name', () => {
    expect(
      describeUpload({
        'content-type': 'application/pdf; charset=binary',
        'x-file-name': encodeURIComponent('Политика.pdf'),
      }),
    ).toEqual({ type: 'application/pdf', fileName: 'Политика.pdf' });
    expect(() => describeUpload({ 'content-type': 'text/html', 'x-file-name': 'a.html' })).toThrow(
      DocumentRejected,
    );
    expect(() => describeUpload({ 'content-type': 'application/pdf', 'x-file-name': '%E0%A4%A' })).toThrow(
      'percent-encode',
    );
  });

  it('are refused above 10 MB, even without a length', async () => {
    const stream = (chunks: Buffer[], length?: number) =>
      Object.assign(Readable.from(chunks), {
        headers: length === undefined ? {} : { 'content-length': String(length) },
      });
    await expect(readUpload(stream([Buffer.alloc(4)], 4), 10)).resolves.toHaveLength(4);
    await expect(readUpload(stream([Buffer.alloc(4)], 11), 10)).rejects.toThrow('at most 10 MB');
    await expect(readUpload(stream([Buffer.alloc(6), Buffer.alloc(6)]), 10)).rejects.toThrow('at most 10 MB');
  });
});

describe('documents', () => {
  it('name their school and person as their attachment needs', () => {
    const school = '0b1d2c3e-0000-7000-8000-00000000000a';
    const person = '0b1d2c3e-0000-7000-8000-000000000001';
    const base = { title: 'Policy', category: 'policy' };
    expect(
      documentSchema.safeParse({ ...base, attachedTo: 'school', schoolId: school, forAllStaff: true })
        .success,
    ).toBe(true);
    expect(documentSchema.safeParse({ ...base, attachedTo: 'staff', personId: person }).success).toBe(true);
    expect(
      documentSchema.safeParse({ ...base, attachedTo: 'student', schoolId: school, personId: person })
        .success,
    ).toBe(true);
    expect(
      documentSchema.safeParse({ ...base, attachedTo: 'staff', schoolId: school, personId: person }).success,
    ).toBe(false);
    expect(
      documentSchema.safeParse({ ...base, attachedTo: 'school', schoolId: school, personId: person }).success,
    ).toBe(false);
    expect(
      documentSchema.safeParse({
        ...base,
        attachedTo: 'student',
        schoolId: school,
        personId: person,
        forAllStaff: true,
      }).success,
    ).toBe(false);
    expect(
      documentSchema.safeParse({ ...base, attachedTo: 'school', schoolId: school, objectKey: 'v1/x' })
        .success,
    ).toBe(false);
  });

  it('are downloaded with random tokens, of which only the hash is kept', () => {
    const token = newToken();
    expect(token).toMatch(TOKEN);
    expect(newToken()).not.toBe(token);
    expect(tokenHash(token)).toHaveLength(32);
    expect(tokenHash(token).toString('base64url')).not.toContain(token);
  });
});
