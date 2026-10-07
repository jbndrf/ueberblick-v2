import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AREAS,
  catalogProblems,
  parseDocTable,
  parseJourneys,
  readJourneys,
} from '../../e2e/journeys/lib/catalog';

const DIR = fileURLToPath(new URL('../../e2e/journeys/', import.meta.url));
const DOC = fileURLToPath(new URL('../../docs/process/v3-journeys.md', import.meta.url));

/** The v3 journey specs (WP-945): every journey has its purpose and v3 lines, and docs/process/v3-journeys.md matches. */
describe('v3 journeys catalog', () => {
  const journeys = readJourneys(DIR);
  const rows = parseDocTable(readFileSync(DOC, 'utf8'));

  it('has one spec file per area', () => {
    expect(AREAS.map((a) => a.area)).toEqual([
      'participant-entry',
      'participant-map',
      'participant-feature',
      'admin-projects-people',
      'admin-settings-data',
      'admin-builder-deploy',
    ]);
    for (const { area } of AREAS)
      expect(
        journeys.some((j) => j.area === area),
        area,
      ).toBe(true);
  });

  it('every journey has Purpose, v3 and Taps lines, a fixme reason, and matches the doc table', () => {
    expect(catalogProblems(journeys, rows)).toEqual([]);
  });

  it('keeps the two harness proofs real; a ported screen turns its own journeys green (the doc table says which)', () => {
    expect(journeys.filter((j) => j.status === 'green' && j.harnessProof).map((j) => j.title)).toEqual([
      'PE-01 QR link signs in [harness proof]',
      'PF-01 A submitted task reaches the server [harness proof]',
    ]);
  });

  it('covers the journeys the work package lists', () => {
    const titles = journeys.map((j) => j.title.toLowerCase()).join('\n');
    for (const needle of [
      'token tab',
      'scanner',
      'reload',
      'basemap',
      'filter',
      'preset',
      'polygon',
      'peek',
      'no-field task',
      'pages',
      'quick edit',
      'photo',
      'aktivität',
      'refused',
      'unsent',
      'einstellungen',
      'zuletzt',
      'logout',
      'projekt erstellen',
      'qr exportieren',
      'selbstbeitritt',
      'beziehungen',
      'kartenebenen',
      'standardansicht',
      'info-seite',
      'csv',
      'add stage',
      'task button',
      'form editor',
      'permission matrix',
      'regel',
      'preview',
      'verschieben nach',
      'rollback',
    ])
      expect(titles, needle).toContain(needle);
  });

  describe('the parser', () => {
    const header = ['// Purpose: p', '// v3: a/b.svelte:1-2   Taps in v3: 3'].join('\n');
    it('reads header, status and reason', () => {
      const text = `${header}\ntest.fixme('XX-01 t', waitsFor('y'), async () => {});`;
      const [j] = parseJourneys('participant-entry', text);
      expect(j).toMatchObject({
        id: 'XX-01',
        status: 'fixme',
        purpose: 'p',
        v3: 'a/b.svelte:1-2',
        taps: '3',
        waitsFor: 'y',
      });
    });
    it('flags a journey without header lines', () => {
      const j = parseJourneys('participant-entry', "test.fixme('XX-01 t', async () => {});");
      const problems = catalogProblems(j, [
        { id: 'XX-01', area: 'participant-entry', lane: 'lead-b', title: 'XX-01 t', status: 'fixme' },
      ]);
      expect(problems.join('\n')).toMatch(/Purpose/);
      expect(problems.join('\n')).toMatch(/v3:/);
      expect(problems.join('\n')).toMatch(/waits for/);
    });
    it('flags a doc row that differs from the spec', () => {
      const j = parseJourneys(
        'participant-entry',
        `${header}\ntest('XX-01 [harness proof]', async () => {});`,
      );
      const problems = catalogProblems(j, [
        { id: 'XX-01', area: 'participant-entry', lane: 'lead-b', title: 'XX-01 other', status: 'fixme' },
      ]);
      expect(problems.join('\n')).toMatch(/doc title/);
      expect(problems.join('\n')).toMatch(/doc status/);
    });
  });
});
