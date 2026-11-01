import { describe, expect, it } from 'vitest';
import { STATE_LABELS, wordingBody } from './consents';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe('consents', () => {
  it('read new wording and whether families are asked again', () => {
    expect(
      wordingBody(form({ wording: '  We may publish photos of your child.  ', renewal_required: 'yes' })),
    ).toEqual({
      wording: 'We may publish photos of your child.',
      renewalRequired: true,
    });
    expect(wordingBody(form({ wording: 'We may publish photos of your child.' })).renewalRequired).toBe(
      false,
    );
    expect(() => wordingBody(form({ wording: 'Photos.' }))).toThrow('in full');
  });

  it('tell staff that consent asked for again counts as no', () => {
    expect(STATE_LABELS.renewal).toMatch(/^No/);
    expect(STATE_LABELS.given).toBe('Yes');
  });
});
