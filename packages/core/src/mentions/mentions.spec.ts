import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MENTION_BODY_MAX, formatMention, isMentionId, mentionTokens, parseMentions } from './index';

const FEATURE = '0192f3a4-7b1c-7e2a-9d3f-5a6b7c8d9e0f';

describe('parseMentions', () => {
  it('reads @person and #feature tokens, de-duplicated in order of first appearance', () => {
    expect(
      parseMentions(`Hi @anna-1a2b3c, see #${FEATURE} and @bob-ffee00 @anna-1a2b3c #${FEATURE}`),
    ).toEqual({
      persons: ['anna-1a2b3c', 'bob-ffee00'],
      features: [FEATURE],
    });
  });

  it('ignores an e-mail address and a token glued to a word', () => {
    expect(parseMentions('mail a@example.org or x#abc or foo@bar')).toEqual({ persons: [], features: [] });
  });

  it('stops a token at punctuation and at a trailing hyphen', () => {
    expect(parseMentions('(@anna-1a2b3c) @bob-x-, #f1.')).toEqual({
      persons: ['anna-1a2b3c', 'bob-x'],
      features: ['f1'],
    });
  });

  it('has the right offsets in mentionTokens', () => {
    const body = 'ab @u1 #f2';
    const t = mentionTokens(body);
    expect(t.map((x) => body.slice(x.start, x.end))).toEqual(['@u1', '#f2']);
    expect(t.map((x) => [x.kind, x.id])).toEqual([
      ['person', 'u1'],
      ['feature', 'f2'],
    ]);
  });

  it('exports the body limit of the chat', () => {
    expect(MENTION_BODY_MAX).toBe(4000);
  });

  const id = fc.stringMatching(/^[a-z0-9]{1,8}(-[a-z0-9]{1,8}){0,4}$/);

  it('property: parse of formatted mentions returns exactly the ids', () => {
    fc.assert(
      fc.property(fc.uniqueArray(id, { maxLength: 6 }), fc.uniqueArray(id, { maxLength: 6 }), (ps, fs) => {
        const body = [
          ...ps.map((p) => formatMention('person', p)),
          ...fs.map((f) => formatMention('feature', f)),
        ].join(' ');
        const got = parseMentions(body);
        expect(got.persons).toEqual(ps);
        expect(got.features).toEqual(fs);
      }),
    );
  });

  it('property: every formatted id is a mention id', () => {
    fc.assert(fc.property(id, (x) => isMentionId(x)));
  });

  it('property: never throws and every token slices to its own text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (s) => {
        const tokens = mentionTokens(s);
        for (const t of tokens) {
          expect(s.slice(t.start + 1, t.end)).toBe(t.id);
          expect(isMentionId(t.id)).toBe(true);
        }
        parseMentions(s);
      }),
    );
  });
});
