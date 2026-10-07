import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { openProject } from '@ueberblick/builder';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  addTypeOp,
  entryHref,
  tablesHref,
  groupTypes,
  newTypeEntry,
  orderTypesOp,
  reorderGroup,
  sidebarTypesOf,
  typeKeyFor,
} from './sidebar-types';
import { editOverlay } from './sidebar-types-client';

const golden = (rel: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
    'utf8',
  );
const TEMPLATE = golden('templates/baumkataster/1.0.0.yaml');
const OVERLAY = golden('projects/musterstadt-baeume.yaml');

describe('which types the sidebar lists where', () => {
  const doc = openProject(TEMPLATE, OVERLAY);
  const types = sidebarTypesOf(doc.effective(), 'de');

  it('Objektarten have a geometry, Tabellen have neither geometry nor process (A-030)', () => {
    const g = groupTypes(types);
    expect(g.objektarten.map((t) => t.key)).toEqual(expect.arrayContaining(['baum', 'flaeche']));
    expect(g.tabellen.map((t) => t.key)).toContain('baumart');
    expect(g.tabellen.map((t) => t.key)).not.toContain('baum');
    expect(g.objektarten.find((t) => t.key === 'baum')?.label).toBe('Baum');
  });

  it('the label is localized', () => {
    expect(sidebarTypesOf(doc.effective(), 'en').find((t) => t.key === 'baum')?.label).toBe('Tree');
  });
});

describe('a new type key', () => {
  it('is a valid key made from the name, unique among the taken ones', () => {
    expect(typeKeyFor('Neue Straße', [])).toBe('neue_strasse');
    expect(typeKeyFor('Baum', ['baum'])).toBe('baum_2');
    expect(typeKeyFor('Baum', ['baum', 'baum_2'])).toBe('baum_3');
    expect(typeKeyFor('123', [])).toBe('t_123');
    expect(typeKeyFor('  ', [])).toBe('objektart');
  });
});

describe('adding a type to the overlay writes an `add` entry the builder accepts', () => {
  for (const kind of ['objektart', 'table'] as const) {
    it(`${kind}: no problems, the type lands in its group`, () => {
      const key = 'neu';
      const out = editOverlay(TEMPLATE, OVERLAY, [addTypeOp(key, newTypeEntry(kind, 'Neu'))]) as string;
      const doc = openProject(TEMPLATE, out);
      expect(doc.problems()).toEqual(openProject(TEMPLATE, OVERLAY).problems()); // no new problem
      const grouped = groupTypes(sidebarTypesOf(doc.effective(), 'de'));
      const into = kind === 'objektart' ? grouped.objektarten : grouped.tabellen;
      expect(into.map((t) => t.key)).toContain(key);
    });
  }

  it('keeps the comments of the overlay', () => {
    const out = editOverlay(TEMPLATE, '# mein Projekt\nschema: ueberblick/1\nextends: baumkataster@1\n', [
      addTypeOp('neu', newTypeEntry('table', 'Neu')),
    ]) as string;
    expect(out).toContain('# mein Projekt');
    expect(parse(out).add['types.neu'].label).toBe('Neu');
  });
});

describe('reordering', () => {
  it('reorderGroup keeps the other group in its slots', () => {
    expect(reorderGroup(['a', 't1', 'b', 't2', 'c'], ['c', 'a', 'b'])).toEqual(['c', 't1', 'a', 't2', 'b']);
  });

  it('writes the overlay `order` entry for types; the effective file follows it', () => {
    const keys = sidebarTypesOf(openProject(TEMPLATE, OVERLAY).effective(), 'de').map((t) => t.key);
    const next = [...keys].reverse();
    const out = editOverlay(TEMPLATE, OVERLAY, [orderTypesOp(next)]) as string;
    expect(parse(out).order.types).toEqual(next);
    const after = sidebarTypesOf(openProject(TEMPLATE, out).effective(), 'de').map((t) => t.key);
    expect(after).toEqual(next);
  });

  it('an op the Doc refuses, or a draft that does not open, gives null', () => {
    expect(editOverlay(TEMPLATE, OVERLAY, [addTypeOp('baum', newTypeEntry('table', 'X'))])).toBeNull();
    expect(editOverlay(TEMPLATE, 'schema: nope', [addTypeOp('neu', newTypeEntry('table', 'N'))])).toBeNull();
  });
});

describe('where an entry leads (S3-18)', () => {
  it('an Objektart opens its data page, a Tabelle its table page (S3-24), the group header the overview', () => {
    expect(entryHref('alpha', { key: 'baum', kind: 'objektart' })).toBe('/admin/projects/alpha/types/baum');
    expect(entryHref('alpha', { key: 'baumart', kind: 'table' })).toBe(
      '/admin/projects/alpha/tables/baumart',
    );
    expect(tablesHref('alpha')).toBe('/admin/projects/alpha/tables');
  });

  it('a new Tabelle is visible to every role, as v3 tables were', () => {
    expect(newTypeEntry('table', 'Neu')).toMatchObject({ permissions: { see: '$all' } });
  });
});
