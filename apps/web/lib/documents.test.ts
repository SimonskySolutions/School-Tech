import { describe, expect, it } from 'vitest';
import { backPath, chosenFile, documentBody, sizeLabel } from './documents';

const SCHOOL = 'b1000000-0000-7000-8000-00000000000a';
const PERSON = 'c1000000-0000-7000-8000-000000000009';
const form = (fields: Record<string, string | File>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe('the documents forms', () => {
  it('say whom a document is about', () => {
    const base = { title: ' Policy ', category: 'policy' };
    expect(documentBody(form({ ...base, attached: 'school', for_all_staff: 'yes' }), SCHOOL)).toEqual({
      attachedTo: 'school',
      schoolId: SCHOOL,
      title: 'Policy',
      category: 'policy',
      forAllStaff: true,
    });
    expect(
      documentBody(form({ ...base, attached: `staff:${PERSON}`, for_all_staff: 'yes' }), SCHOOL),
    ).toEqual({
      attachedTo: 'staff',
      personId: PERSON,
      title: 'Policy',
      category: 'policy',
    });
    expect(documentBody(form({ ...base, attached: `student:${PERSON}` }), SCHOOL)).toMatchObject({
      attachedTo: 'student',
      schoolId: SCHOOL,
      personId: PERSON,
    });
    expect(() => documentBody(form({ ...base, attached: 'staff:someone' }), SCHOOL)).toThrow('whom');
    expect(() => documentBody(form({ ...base, attached: 'school', category: 'diary' }), SCHOOL)).toThrow(
      'kind',
    );
  });

  it('take a file of a kept type, at most 10 MB', () => {
    expect(chosenFile(form({ file: new File(['%PDF-'], 'a.pdf', { type: 'application/pdf' }) })).type).toBe(
      'application/pdf',
    );
    expect(
      chosenFile(form({ file: new File(['x'], 'Notes.TXT', { type: 'application/octet-stream' }) })).type,
    ).toBe('text/plain');
    expect(chosenFile(form({ file: new File(['x'], 'photo.jpeg') })).type).toBe('image/jpeg');
    expect(() => chosenFile(form({ file: new File(['x'], 'page.html', { type: 'text/html' }) }))).toThrow(
      'only',
    );
    expect(() => chosenFile(form({ file: new File([], 'empty.pdf') }))).toThrow('choose the file');
    expect(() =>
      chosenFile(form({ file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf') })),
    ).toThrow('10 MB');
    expect(() => chosenFile(form({}))).toThrow('choose the file');
  });

  it('go back only to a page of this site', () => {
    expect(backPath('/staff/me')).toBe('/staff/me');
    expect(backPath('//evil.test/x')).toBe('/');
    expect(backPath('https://evil.test')).toBe('/');
    expect(backPath('/' + String.fromCharCode(92) + 'evil.test')).toBe('/');
  });

  it('give sizes people read', () => {
    expect(sizeLabel(900)).toBe('900 B');
    expect(sizeLabel(2048)).toBe('2 KB');
    expect(sizeLabel(3.5 * 1024 * 1024)).toBe('3.5 MB');
  });
});
