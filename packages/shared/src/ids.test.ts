import { describe, expect, it } from 'vitest';
import { isUuid, parseId } from './ids.js';

describe('ids', () => {
  it('accepts lowercase UUIDs, including version 7', () => {
    expect(isUuid('0199a3f2-7c1e-7000-8000-00000000000a')).toBe(true);
    expect(parseId('c1000000-0000-7000-8000-000000000020', 'person')).toBe(
      'c1000000-0000-7000-8000-000000000020',
    );
  });

  it('rejects anything else', () => {
    for (const value of ['', 'not-a-uuid', 'C1000000-0000-7000-8000-000000000020', 42, null, undefined]) {
      expect(isUuid(value)).toBe(false);
    }
    expect(() => parseId("1' OR '1'='1", 'school')).toThrow('invalid school id');
  });
});
