import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bodySegments } from './body';

describe('bodySegments', () => {
  it('splits text, @person and #feature chips, and marks a mention of the reader', () => {
    expect(bodySegments('Hi @anna-1 and @me-2, look at #f9 now', 'me-2')).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'person', id: 'anna-1', me: false },
      { kind: 'text', text: ' and ' },
      { kind: 'person', id: 'me-2', me: true },
      { kind: 'text', text: ', look at ' },
      { kind: 'feature', id: 'f9' },
      { kind: 'text', text: ' now' },
    ]);
  });
  it('leaves an e-mail address as text', () => {
    expect(bodySegments('mail a@example.org', 'x')).toEqual([{ kind: 'text', text: 'mail a@example.org' }]);
  });
  it('property: the segments read back as the body, tokens included', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (body) => {
        const text = bodySegments(body, 'me')
          .map((s) => (s.kind === 'text' ? s.text : `${s.kind === 'person' ? '@' : '#'}${s.id}`))
          .join('');
        expect(text).toBe(body);
      }),
    );
  });
});
