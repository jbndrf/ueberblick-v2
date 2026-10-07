import { describe, expect, it } from 'vitest';
import type { Instant, RunId } from '@ueberblick/core/model';
import type { ActivityRun, ActivitySegment, ActivityView } from '@ueberblick/ui';
import { activityLabelText, latestActivity } from './label';

const at = (h: number): Instant => `2026-10-01T0${h}:00:00.000Z` as Instant;
const run = (h: number, label: ActivityRun['label'], task = 'Kontrolle'): ActivityRun => ({
  runId: `r${h}` as RunId,
  task,
  actorLabel: 'x',
  at: at(h),
  status: 'synced' as never,
  label,
  fields: [],
  touchedGeometry: false,
});
const seg = (extra: Partial<ActivitySegment>): ActivitySegment => ({
  key: '0',
  visitIndex: 1,
  visitTotal: 1,
  initial: true,
  entries: [],
  ...extra,
});
const view = (s: ActivitySegment): ActivityView => ({ segments: [s] });

describe('activityLabelText', () => {
  it('words each kind as v3 did', () => {
    expect(activityLabelText({ kind: 'created' }, 't', 'de')).toBe('Erstellt');
    expect(activityLabelText({ kind: 'location' }, 't', 'de')).toBe('Standort aktualisiert');
    expect(activityLabelText({ kind: 'field', label: 'Befund' }, 't', 'de')).toBe('Befund aktualisiert');
    expect(activityLabelText({ kind: 'fields', count: 3 }, 't', 'de')).toBe('3 Felder aktualisiert');
    expect(activityLabelText({ kind: 'task' }, 'Kontrolle', 'de')).toBe('Kontrolle');
  });
});

describe('latestActivity', () => {
  it('is empty for no timeline', () => {
    expect(latestActivity({ segments: [] }, 'de')).toEqual({});
  });
  it('takes the newest run and the stage', () => {
    const got = latestActivity(
      view(
        seg({
          stageLabel: 'Prüfung',
          entries: [run(5, { kind: 'fields', count: 2 }), run(3, { kind: 'task' })],
        }),
      ),
      'de',
    );
    expect(got).toEqual({ text: '2 Felder aktualisiert', stage: 'Prüfung' });
  });
  it('a newer stage move wins over an older run and is worded as Statuswechsel', () => {
    const got = latestActivity(
      view(
        seg({
          stageLabel: 'Fertig',
          transition: { at: at(6), by: 'x', status: 'synced' as never },
          entries: [run(4, { kind: 'task' })],
        }),
      ),
      'de',
    );
    expect(got.text).toBe('Statuswechsel: Fertig');
  });
  it('the creation shows Erstellt when it is the only entry', () => {
    expect(latestActivity(view(seg({ creation: run(1, { kind: 'created' }) })), 'en').text).toBe('Created');
  });
});
