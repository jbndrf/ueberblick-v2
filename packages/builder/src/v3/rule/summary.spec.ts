// C-004 step 1: the one-line outcome of an automatic action, read from the task it owns.
import { describe, expect, it } from 'vitest';
import { goldenDoc } from '../../lenses/process/fixtures';
import { isAutomaticOnly, ownedTasks } from './auto-task';
import { outcomeParts } from './summary';

const WORDS = { yes: 'ja', no: 'nein', empty: 'leer', lifecycle: 'Zustand' };
const meldung = () => goldenDoc('maengelmelder', '1.0.0').effective();

describe('the outcome of an automatic action', () => {
  it('reads set steps as "Eigenschaft → Wert", options by their label', () => {
    expect(outcomeParts(meldung(), 'eskalieren', 'meldung', 'de', WORDS)).toEqual([
      'Eskaliert → ja',
      'Priorität → Hoch',
    ]);
    expect(outcomeParts(meldung(), 'eskalieren', 'meldung', 'en', WORDS)).toEqual([
      'Escalated → ja',
      'Priority → High',
    ]);
  });

  it('is empty for a task that is not there', () => {
    expect(outcomeParts(meldung(), 'gibt_es_nicht', 'meldung', 'de', WORDS)).toEqual([]);
  });
});

describe('which tasks an automatic action owns', () => {
  it('owns the system-only task only one automatic action carries', () => {
    const owned = ownedTasks(meldung());
    expect([...owned]).toEqual(expect.arrayContaining(['benachrichtigen', 'eskalieren']));
    expect(owned.has('melden')).toBe(false);
  });

  it('a system-only task with two automatic actions belongs to none: it is automatic-only', () => {
    const doc = goldenDoc('maengelmelder', '1.0.0').apply({
      kind: 'add',
      path: 'tasks.eskalieren.auto.zweite',
      value: { after: 'melden' },
    }).doc;
    const file = doc.effective();
    expect(ownedTasks(file).has('eskalieren')).toBe(false);
    expect(isAutomaticOnly(file, 'eskalieren')).toBe(true);
    expect(isAutomaticOnly(file, 'melden')).toBe(false);
  });
});
