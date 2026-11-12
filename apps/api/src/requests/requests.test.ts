import { describe, expect, it } from 'vitest';
import { openSchema, replySchema, statusSchema } from './requests.controller';

const id = '01a18e7b-baec-7c6b-a92d-881b1ae3371a';

describe('request rules', () => {
  it('opens a request of a known kind with a subject and a message', () => {
    expect(
      openSchema.safeParse({ schoolId: id, kind: 'absence', subject: 'Ill', message: 'A cold' }).success,
    ).toBe(true);
    expect(openSchema.safeParse({ schoolId: id, kind: 'gossip', subject: 'x', message: 'y' }).success).toBe(
      false,
    );
    expect(openSchema.safeParse({ schoolId: id, kind: 'question', subject: ' ', message: 'y' }).success).toBe(
      false,
    );
    expect(
      openSchema.safeParse({ schoolId: id, kind: 'question', subject: 'x', message: 'y'.repeat(4001) })
        .success,
    ).toBe(false);
  });

  it('takes a reply and only the statuses staff or families may set', () => {
    expect(replySchema.safeParse({ message: 'Thank you' }).success).toBe(true);
    expect(replySchema.safeParse({ message: '' }).success).toBe(false);
    expect(statusSchema.safeParse({ status: 'closed' }).success).toBe(true);
    expect(statusSchema.safeParse({ status: 'answered' }).success).toBe(false);
  });
});
