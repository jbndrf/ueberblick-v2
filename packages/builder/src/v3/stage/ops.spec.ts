import { describe, expect, it } from 'vitest';
import { openProject, type Doc, type Op } from '../../doc';
import { goldenProjects, musterstadt } from '../../testing/golden';
import { problemItems } from '../../problems/model';
import { stageDeleteImpact, stageLock, stageOps, stageTypeOf, STAGE_TYPES } from './ops';

const open = () => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const file = () => open().effective();
const meldungen = goldenProjects.find((p) => p.name.startsWith('stadtwerke'));
const openMeldungen = () => {
  if (meldungen === undefined) throw new Error('golden project missing');
  return openProject(meldungen.templateSrc, meldungen.overlaySrc);
};

describe('stage type', () => {
  it('reads start, intermediate and end from the process of the type', () => {
    const f = file();
    expect(stageTypeOf(f, 'baum', 'erfasst')).toBe(STAGE_TYPES.start);
    expect(stageTypeOf(f, 'baum', 'kontrolliert')).toBe(STAGE_TYPES.intermediate);
    expect(stageTypeOf(f, 'baum', 'erledigt')).toBe(STAGE_TYPES.end);
  });

  it('marking a stage as end or start writes process and compiles', () => {
    const doc = open();
    const end = stageOps.setType(doc.effective(), 'baum', 'massnahme', STAGE_TYPES.end);
    if (!end.ok || end.op === undefined) throw new Error('refused');
    const a = doc.apply(end.op);
    expect(a.refused).toBeUndefined();
    expect(a.doc.effective().types?.['baum']?.process).toMatchObject({ end: ['erledigt', 'massnahme'] });
    expect(problemItems(a.doc, 'de')).toEqual(problemItems(doc, 'de'));

    const start = stageOps.setType(a.doc.effective(), 'baum', 'kontrolliert', STAGE_TYPES.start);
    if (!start.ok || start.op === undefined) throw new Error('refused');
    const b = a.doc.apply(start.op);
    expect(b.doc.effective().types?.['baum']?.process?.start).toBe('kontrolliert');
    expect(problemItems(b.doc, 'de').filter((p) => p.code.startsWith('process_'))).toEqual([]);
  });

  it('end may not contain start: the start only moves by choosing another start', () => {
    const f = file();
    expect(stageOps.setType(f, 'baum', 'erfasst', STAGE_TYPES.end)).toMatchObject({
      ok: false,
      reason: 'start_needed',
    });
    expect(stageOps.setType(f, 'baum', 'erfasst', STAGE_TYPES.intermediate)).toMatchObject({
      ok: false,
      reason: 'start_needed',
    });
    // the only end cannot become a middle stage, nor the start
    expect(stageOps.setType(f, 'baum', 'erledigt', STAGE_TYPES.intermediate)).toMatchObject({
      ok: false,
      reason: 'end_needed',
    });
    expect(stageOps.setType(f, 'baum', 'erledigt', STAGE_TYPES.start)).toMatchObject({
      ok: false,
      reason: 'end_needed',
    });
  });

  it('a type without a process has nothing to set', () => {
    expect(stageOps.setType(file(), 'flaeche', 'x', STAGE_TYPES.end)).toMatchObject({
      ok: false,
      reason: 'no_process',
    });
  });
});

const renameOp = (doc: Doc, type: string, stage: string, text: string): Op => {
  const op = stageOps.rename(doc.effective(), type, stage, 'de', text);
  if (op === undefined) throw new Error('no process');
  return op;
};

describe('rename', () => {
  it('a type without a process gives no op (no fallback property)', () => {
    const doc = open();
    expect(stageOps.rename(doc.effective(), 'flaeche', 'x', 'de', 'Neu')).toBeUndefined();
    expect(stageDeleteImpact(doc, 'flaeche', 'x', 'de')).toBeUndefined();
    expect(stageLock(doc, 'flaeche', 'x', 'de')).toBeUndefined();
  });

  it('writes the option label and keeps the key', () => {
    const doc = openMeldungen();
    const r = doc.apply(renameOp(doc, 'meldung', 'bewertet', 'Geprüft'));
    expect(r.refused).toBeUndefined();
    const options = r.doc.effective().types?.['meldung']?.properties['status']?.options ?? {};
    expect(JSON.stringify(options['bewertet'])).toContain('Geprüft');
    expect(Object.keys(options)).toContain('bewertet');
  });

  it('the pane and the canvas edit the same entry: a set on options.<key>', () => {
    const op = stageOps.rename(openMeldungen().effective(), 'meldung', 'bewertet', 'de', 'X');
    expect(op).toMatchObject({ kind: 'set', path: 'types.meldung.properties.status.options.bewertet' });
  });

  it('a template that locks its stages refuses; the doc stays unchanged', () => {
    const doc = open();
    const r = doc.apply(renameOp(doc, 'baum', 'kontrolliert', 'X'));
    expect(r.refused?.message).toContain('locks');
    expect(r.doc).toBe(doc);
  });
});

describe('add button and delete', () => {
  it('a new button is a task pinned to the stage', () => {
    const doc = openMeldungen();
    const r = stageOps.addButton(doc.effective(), 'meldung', 'bewertet', 'de', 'Neue Aufgabe');
    if (!r.ok) throw new Error('refused');
    const a = doc.apply(r.op);
    expect(a.refused).toBeUndefined();
    expect(a.doc.effective().tasks?.[r.key]).toMatchObject({
      on: 'meldung',
      when: "self.status == 'bewertet'",
    });
  });

  it('delete lists what breaks and removes the option', () => {
    const doc = openMeldungen();
    const impact = stageDeleteImpact(doc, 'meldung', 'bewertet', 'de');
    expect(impact?.after.effective().types?.['meldung']?.properties['status']?.options).not.toHaveProperty(
      'bewertet',
    );
    const start = stageDeleteImpact(doc, 'meldung', 'offen', 'de');
    expect(start?.problems.length).toBeGreaterThan(0);
  });
});

describe('lock', () => {
  it('names the lock of a template that fixes its stages, and is silent otherwise', () => {
    expect(stageLock(open(), 'baum', 'kontrolliert', 'de')).toContain('locks');
    expect(stageLock(openMeldungen(), 'meldung', 'bewertet', 'de')).toBeUndefined();
  });
});
