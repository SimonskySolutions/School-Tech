import { createHash, randomBytes } from 'node:crypto';
import { DOCUMENT_TYPES, type DocumentContentType } from '@pythagoras/shared';

// What may be uploaded and how it goes back out (ADR 0029): the listed types
// only, their first bytes matching the declared type, file names without
// paths or control characters, always downloaded as an attachment.

export const isDocumentType = (value: string): value is DocumentContentType =>
  Object.hasOwn(DOCUMENT_TYPES, value);

const startsWith = (bytes: Buffer, prefix: readonly number[]) =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
// An OpenDocument file is a ZIP whose first entry, "mimetype", stored
// uncompressed, holds the type itself.
const openDocument = (bytes: Buffer, type: string) =>
  startsWith(bytes, ZIP) &&
  bytes.subarray(30, 38).toString('latin1') === 'mimetype' &&
  bytes.subarray(38, 38 + type.length).toString('latin1') === type;

/** Do the file's first bytes say it is what it claims to be? */
export function looksLike(type: DocumentContentType, bytes: Buffer): boolean {
  switch (type) {
    case 'application/pdf':
      return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'text/plain':
      if (bytes.includes(0)) return false;
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return true;
      } catch {
        return false;
      }
    case 'application/vnd.oasis.opendocument.text':
    case 'application/vnd.oasis.opendocument.spreadsheet':
      return openDocument(bytes, type);
    default:
      return startsWith(bytes, ZIP);
  }
}

/** The last part of a path, without control characters, ending in the type's extension. */
export function cleanFileName(name: string, type: DocumentContentType): string {
  const extension = DOCUMENT_TYPES[type];
  let base = (name.split(/[/\\]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (base === '.' || base === '..') base = '';
  const own = /\.([A-Za-z0-9]+)$/.exec(base);
  const ownExtension = own?.[1]?.toLowerCase();
  const keeps = ownExtension === extension || (type === 'image/jpeg' && ownExtension === 'jpeg');
  const suffix = keeps && own ? own[0] : `.${extension}`;
  const stem = (keeps && own ? base.slice(0, -own[0].length).trim() : base) || 'document';
  return `${stem.slice(0, 200 - suffix.length)}${suffix}`;
}

/** An attachment header that survives any file name. */
export function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest();
export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest();
