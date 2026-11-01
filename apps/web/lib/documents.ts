import {
  type DocumentAttachedTo,
  type DocumentCategory,
  type DocumentContentType,
  type DocumentRequestBody,
  DOCUMENT_CATEGORIES,
  DOCUMENT_MAX_BYTES,
  DOCUMENT_TYPES,
} from '@pythagoras/shared';
import { FormProblem, text } from './admin';

// The documents pages (M6.4, ADR 0029): labels, and the forms read into the
// API's request bodies. The API checks everything again.

type Form = Pick<FormData, 'get'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  policy: 'Policy',
  plan: 'Plan',
  contract: 'Contract',
  certificate: 'Certificate',
  report: 'Report',
  letter: 'Letter',
  other: 'Other',
};

export const ATTACHED_LABELS: Record<DocumentAttachedTo, string> = {
  school: 'The school',
  staff: 'Staff',
  student: 'Pupils',
};

export const TYPE_LABELS: Record<DocumentContentType, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'text/plain': 'Text',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.oasis.opendocument.text': 'OpenDocument text',
  'application/vnd.oasis.opendocument.spreadsheet': 'OpenDocument spreadsheet',
};

/** What the file inputs accept: the extensions of the kept types. */
export const ACCEPT = [...new Set([...Object.values(DOCUMENT_TYPES), 'jpeg'])]
  .map((ext) => `.${ext}`)
  .join(',');

export const DOCUMENTS_DONE: Record<string, string> = {
  filed: 'The document is filed.',
  versioned: 'The new version is kept; earlier ones stay as they were.',
  archived: 'The document is archived. It stays on record.',
};

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('en-GB', { maximumFractionDigits: 1 })} MB`;
}

/** The new document's details; "attached" is "school", "staff:<id>" or "student:<id>". */
export function documentBody(form: Form, schoolId: string): DocumentRequestBody {
  const title = text(form, 'title');
  if (!title || title.length > 200) throw new FormProblem('give the title');
  const category = text(form, 'category');
  if (!(DOCUMENT_CATEGORIES as readonly string[]).includes(category))
    throw new FormProblem('choose the kind');
  const [attachedTo, personId] = text(form, 'attached').split(':');
  if (attachedTo === 'school') {
    return {
      attachedTo,
      schoolId,
      title,
      category: category as DocumentCategory,
      forAllStaff: text(form, 'for_all_staff') === 'yes',
    };
  }
  if ((attachedTo !== 'staff' && attachedTo !== 'student') || !personId || !UUID.test(personId)) {
    throw new FormProblem('choose whom the document is about');
  }
  return {
    attachedTo,
    ...(attachedTo === 'student' ? { schoolId } : {}),
    personId,
    title,
    category: category as DocumentCategory,
  };
}

const BY_EXTENSION = new Map<string, DocumentContentType>(
  [
    ...Object.entries(DOCUMENT_TYPES).map(([type, ext]) => [ext, type] as const),
    ['jpeg', 'image/jpeg'] as const,
  ].map(([ext, type]) => [ext, type as DocumentContentType]),
);

/** The chosen file, its type from the browser or else from its extension. */
export function chosenFile(form: Form): { file: File; type: DocumentContentType } {
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) throw new FormProblem('choose the file');
  if (file.size > DOCUMENT_MAX_BYTES) throw new FormProblem('a file may be at most 10 MB');
  const declared = file.type.split(';')[0]!.trim().toLowerCase();
  const type = Object.hasOwn(DOCUMENT_TYPES, declared)
    ? (declared as DocumentContentType)
    : BY_EXTENSION.get(file.name.split('.').pop()?.toLowerCase() ?? '');
  if (!type) throw new FormProblem('PDF, PNG, JPEG, text, Word, Excel or OpenDocument files only');
  return { file, type };
}

/** Where to go back after a download request: a path on this site only. */
export function backPath(value: string): string {
  return value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}
