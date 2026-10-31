import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import { openBody, replyBody } from './requests';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe('request forms', () => {
  it('reads a new request of a known kind with a subject and a message', () => {
    expect(
      openBody(form({ school_id: 'a', kind: 'absence', subject: ' Dentist ', message: ' At 11 ' })),
    ).toEqual({
      schoolId: 'a',
      kind: 'absence',
      subject: 'Dentist',
      message: 'At 11',
    });
    expect(() => openBody(form({ kind: 'gossip', subject: 'x', message: 'y' }))).toThrow(FormProblem);
    expect(() => openBody(form({ kind: 'question', subject: '', message: 'y' }))).toThrow(FormProblem);
    expect(() => openBody(form({ kind: 'question', subject: 'x', message: '' }))).toThrow(FormProblem);
  });

  it('reads a reply', () => {
    expect(replyBody(form({ message: 'Thanks' }))).toEqual({ message: 'Thanks' });
    expect(() => replyBody(form({ message: 'x'.repeat(4001) }))).toThrow(FormProblem);
  });
});
