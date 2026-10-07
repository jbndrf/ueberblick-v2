import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isTable } from './is-table';

/** The definition the admin's Tabellen page and the builder each carried before WP-412. */
const oldDefinition = (def: { geometry?: unknown; process?: unknown }): boolean =>
  def.geometry === undefined && def.process === undefined;

describe('isTable', () => {
  it('agrees with the old definition for any combination of geometry and process', () => {
    fc.assert(
      fc.property(
        fc.record({
          geometry: fc.option(fc.constantFrom('point', 'line', 'polygon'), { nil: undefined }),
          process: fc.option(fc.record({ property: fc.string() }), { nil: undefined }),
          label: fc.string(),
        }),
        (def) => {
          expect(isTable(def as never)).toBe(oldDefinition(def));
        },
      ),
    );
  });

  it('a type with a geometry or a process is not a table', () => {
    expect(isTable({ geometry: 'point' } as never)).toBe(false);
    expect(isTable({ process: { property: 'stage' } } as never)).toBe(false);
    expect(isTable({} as never)).toBe(true);
  });
});
