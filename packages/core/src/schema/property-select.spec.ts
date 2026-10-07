// WP-725: `participant` properties carry `select: { all, self }` (v3 any_select_roles / self_select_roles).
import { describe, expect, it } from 'vitest';
import { PropertySchema } from './property';
import { choosesAnyParticipant, participantChoice } from '../registry/participant-select';

const prop = (extra: Record<string, unknown> = {}) => PropertySchema.parse({ type: 'participant', ...extra });

describe('participant select', () => {
  it('parses all and self, and rejects it on other types and unknown keys', () => {
    expect(prop({ select: { all: ['sachbearbeiter'], self: ['handwerker'] } }).select).toEqual({
      all: ['sachbearbeiter'],
      self: ['handwerker'],
    });
    expect(PropertySchema.safeParse({ type: 'text', select: { all: ['a'] } }).success).toBe(false);
    expect(PropertySchema.safeParse({ type: 'participant', select: { any: ['a'] } }).success).toBe(false);
  });

  it('follows v3: all wins, then self, otherwise nobody; absent select means oneself', () => {
    const p = prop({ select: { all: ['sachbearbeiter'], self: ['handwerker'] } });
    expect(participantChoice(p, ['sachbearbeiter'])).toEqual({ everyone: true, oneself: true });
    expect(participantChoice(p, ['handwerker'])).toEqual({ everyone: false, oneself: true });
    expect(participantChoice(p, ['melder'])).toEqual({ everyone: false, oneself: false });
    expect(participantChoice(p, ['handwerker', 'sachbearbeiter'])).toEqual({ everyone: true, oneself: true });
    expect(participantChoice(prop(), ['melder'])).toEqual({ everyone: false, oneself: true });
  });

  it('knows whether a role may choose anyone on some property', () => {
    const types = {
      a: { properties: { x: prop(), y: prop({ select: { all: ['boss'] } }) } },
      b: { properties: { t: PropertySchema.parse({ type: 'text' }) } },
    };
    expect(choosesAnyParticipant(types, ['boss'])).toBe(true);
    expect(choosesAnyParticipant(types, ['worker'])).toBe(false);
    expect(choosesAnyParticipant(undefined, ['boss'])).toBe(false);
  });
});
