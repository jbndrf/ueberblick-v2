import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FeatureTypeSchema, type FeatureType } from '../schema';
import { processesOf } from './index';

const type = (extra: Record<string, unknown> = {}): FeatureType =>
  FeatureTypeSchema.parse({
    label: 'Baum',
    properties: {
      stage: { type: 'select', options: { neu: 'Neu', fertig: 'Fertig', zu: 'Zu' } },
      befund: { type: 'text' },
    },
    ...extra,
  });

describe('processesOf', () => {
  it('returns the declared process with its stages', () => {
    const t = type({ process: { property: 'stage', start: 'neu', end: ['fertig', 'zu'] } });
    expect(processesOf(t)).toEqual([
      { property: 'stage', start: 'neu', end: ['fertig', 'zu'], options: ['neu', 'fertig', 'zu'] },
    ]);
  });

  it('returns [] for a type without a process', () => {
    expect(processesOf(type())).toEqual([]);
  });

  it('property: 0 or 1 entries, and start and end are options of a select property', () => {
    const key = fc.stringMatching(/^[a-z][a-z0-9_]{0,6}$/);
    fc.assert(
      fc.property(fc.uniqueArray(key, { minLength: 2, maxLength: 6 }), fc.boolean(), (options, declare) => {
        const [start, ...rest] = options;
        const t = FeatureTypeSchema.parse({
          label: 'T',
          properties: { s: { type: 'select', options: Object.fromEntries(options.map((o) => [o, o])) } },
          ...(declare ? { process: { property: 's', start, end: rest.slice(0, 1) } } : {}),
        });
        const list = processesOf(t);
        expect(list.length).toBe(declare ? 1 : 0);
        for (const p of list) {
          expect(t.properties[p.property]?.type).toBe('select');
          const opts = Object.keys(t.properties[p.property]?.options ?? {});
          expect(opts).toContain(p.start);
          for (const e of p.end) expect(opts).toContain(e);
          expect(p.options).toEqual(opts);
        }
      }),
    );
  });
});
