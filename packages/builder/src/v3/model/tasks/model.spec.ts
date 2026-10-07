import { describe, expect, it } from 'vitest';
import { openProject } from '../../../doc';
import { goldenDoc } from '../../../lenses/process/fixtures';
import { musterstadt } from '../../../testing/golden';
import { TASK_PHASES, TASK_STARTS, buildTaskRows } from './model';

/** The golden task `befund_ergaenzen` with the two-role `who` these tests drive (WP-410 narrowed the golden file to one role). */
const TWO_ROLES = (src: string): string => {
  const one = `    on: baum\n    who: [ kontrolle ]\n    form:\n      befund:`;
  if (!src.includes(one)) throw new Error('golden befund_ergaenzen changed: update this fixture patch');
  return src.replace(one, one.replace('[ kontrolle ]', '[ kontrolle, bauhof ]'));
};

const doc = openProject(TWO_ROLES(musterstadt.templateSrc), musterstadt.overlaySrc);
const rows = buildTaskRows(doc, 'baum', 'de');
const row = (key: string) => rows.find((r) => r.key === key);

describe('the Aufgaben table lists every task of the Objektart (acceptance 2)', () => {
  it('has the tasks offered on the type and the entry that creates it, not the ones of other types', () => {
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining(['erfassen', 'kontrolle', 'befund_ergaenzen', 'verschieben', 'zuweisen']),
    );
    expect(keys).not.toContain('flaeche_bearbeiten');
    expect(keys).not.toContain('massnahme_erledigen');
  });

  it('shows the name, the role clause ("Wer darf dies nutzen") as role labels and the form field count', () => {
    expect(row('kontrolle')).toMatchObject({ label: 'Regelkontrolle', roles: ['Baumkontrolle'], fields: 5 });
    expect(row('befund_ergaenzen')?.roles).toEqual(['Baumkontrolle', 'Bauhof']);
    expect(row('erfassen')?.fields).toBe(4);
  });

  it('shows where a task is offered: the entry, every Phase, or the pinned Phasen', () => {
    expect(row('erfassen')?.phase).toBe(TASK_PHASES.entry);
    expect(row('kontrolle')?.phase).toBe(TASK_PHASES.any);
    expect(row('massnahme_anlegen')?.phase).toBe(TASK_PHASES.pinned);
    expect(row('massnahme_anlegen')?.phases).toEqual(['Maßnahme']);
  });

  it('shows how a task starts and the Phase it leads to', () => {
    expect(row('kontrolle')?.start).toBe(TASK_STARTS.manual);
    expect(row('kontrolle')?.targets).toEqual(expect.arrayContaining(['Maßnahme', 'Kontrolliert']));
  });

  it('lists the roles of `who` as labels', () => {
    expect(row('zuweisen')?.roles).toEqual(['Verwaltung', 'admin']);
    expect(row('kontrolle')?.roles).toEqual(['Baumkontrolle']);
  });
});

describe('the Aufgaben table treats automatic actions like the catalog (C-004 step 1)', () => {
  const meldung = goldenDoc('maengelmelder', '1.0.0');

  it("an automatic action's own task is not a row", () => {
    const keys = buildTaskRows(meldung, 'meldung', 'de').map((r) => r.key);
    expect(keys).toContain('bewerten');
    expect(keys).not.toContain('eskalieren');
  });

  it('a system-only task no single automatic action owns is a row, started automatically', () => {
    const doc = meldung.apply({
      kind: 'add',
      path: 'tasks.eskalieren.auto.zweite',
      value: { after: 'melden' },
    }).doc;
    const row = buildTaskRows(doc, 'meldung', 'de').find((r) => r.key === 'eskalieren');
    expect(row?.start).toBe(TASK_STARTS.rule);
  });
});
