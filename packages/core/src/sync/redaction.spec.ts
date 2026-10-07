import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FeatureId } from '../model';
import { SyncProtocolError, parseRedactionKey, redactionKey } from './index';

const fid = fc.uuid().map((s) => s as FeatureId);
const property = fc.string({ minLength: 1 });

describe('redaction key', () => {
  it('round-trips, also for property keys that contain the separator', () => {
    fc.assert(
      fc.property(fid, property, (id, p) => {
        expect(parseRedactionKey(redactionKey(id, p))).toEqual({ featureId: id, property: p });
      }),
    );
    expect(parseRedactionKey(redactionKey('f' as FeatureId, 'a#b#'))).toEqual({
      featureId: 'f',
      property: 'a#b#',
    });
  });

  it('refuses keys that cannot be told apart, with a typed malformed error', () => {
    for (const bad of ['', 'no-separator', '#name', 'id#'])
      expect(() => parseRedactionKey(bad)).toThrowError(expect.objectContaining({ code: 'malformed' }));
    expect(() => redactionKey('a#b' as FeatureId, 'p')).toThrowError(SyncProtocolError);
    expect(() => redactionKey('a' as FeatureId, '')).toThrowError(SyncProtocolError);
  });
});
