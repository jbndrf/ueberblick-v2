import { describe, expect, it } from 'vitest';
import { type Key } from '@ueberblick/core';
import { openProject } from '../../doc';
import { openSimulation } from '../../simulate';
import { musterstadt } from '../../testing/golden';
import { goldenDoc } from '../../lenses/process/fixtures';
import { ALL_ROLES, previewActor, previewRoles, stagePreview } from './preview';

const doc = () => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

describe('participant preview', () => {
  it('lists the roles of the file for the picker', () => {
    expect(previewRoles(doc().effective(), 'de').map((r) => r.key)).toEqual(
      expect.arrayContaining(['kontrolle', 'verwaltung', 'bauhof']),
    );
  });

  it.each(['erfasst', 'kontrolliert', 'massnahme', 'erledigt'])(
    'for role kontrolle in %s the offered tasks are exactly those core offers',
    (stage) => {
      const file = doc().effective();
      const preview = stagePreview(file, 'baum', stage, 'kontrolle', 'de');
      const opened = openSimulation(file);
      if (!opened.ok) throw new Error('no simulation');
      const sim = opened.simulation;
      const id = sim.generate('baum' as Key, { stage });
      const offered = sim
        .availability(id, previewActor('kontrolle'))
        .filter((a) => a.ok)
        .map((a) => a.task as string)
        .sort();
      expect(
        preview.buttons
          .filter((b) => !b.dimmed)
          .map((b) => b.key)
          .sort(),
      ).toEqual(offered);
    },
  );

  it('a dimmed button says why', () => {
    const preview = stagePreview(doc().effective(), 'baum', 'erfasst', 'bauhof', 'de');
    const dimmed = preview.buttons.filter((b) => b.dimmed);
    expect(dimmed.length).toBeGreaterThan(0);
    expect(dimmed.every((b) => (b.why ?? '') !== '')).toBe(true);
  });

  it('all roles dims nothing; a stage-less preview has no buttons', () => {
    const file = doc().effective();
    expect(stagePreview(file, 'baum', 'erfasst', ALL_ROLES, 'de').buttons.some((b) => b.dimmed)).toBe(false);
    expect(stagePreview(file, 'baum', null, ALL_ROLES, 'de').buttons).toEqual([]);
  });

  it('a button is the stage own (pinned) or global (unpinned)', () => {
    const p = stagePreview(doc().effective(), 'baum', 'erfasst', ALL_ROLES, 'de');
    expect(p.buttons.length).toBeGreaterThan(0);
    expect(p.buttons.every((b) => b.global !== b.own)).toBe(true);
  });

  it('shows the properties a role may see, and which it may edit', () => {
    const file = doc().effective();
    const kontrolle = stagePreview(file, 'baum', 'erfasst', 'kontrolle', 'de').properties;
    const bauhof = stagePreview(file, 'baum', 'erfasst', 'bauhof', 'de').properties;
    expect(kontrolle.find((p) => p.key === 'intern_notiz')?.visible).toBe(true);
    expect(bauhof.find((p) => p.key === 'intern_notiz')?.visible).toBe(false);
    expect(kontrolle.find((p) => p.key === 'vitalitaet')?.editable).toBe(true);
    expect(bauhof.find((p) => p.key === 'vitalitaet')?.editable).toBe(false);
  });
});

describe('button colours in the preview bar', () => {
  it("a button carries its task's button.color as the participant app draws it", () => {
    const file = doc().effective();
    const base = stagePreview(file, 'baum', 'erfasst', ALL_ROLES, 'de').buttons;
    const [a, b, c] = base.map((x) => x.key);
    if (a === undefined || b === undefined || c === undefined) throw new Error('need three buttons');
    const tasks = file.tasks ?? {};
    const painted = {
      ...file,
      tasks: {
        ...tasks,
        [a]: { ...tasks[a], button: { color: 'danger' } },
        [b]: { ...tasks[b], button: { color: '#aa0000' } },
        [c]: { ...tasks[c], button: { color: 'neutral' } },
      },
    } as typeof file;
    const by = new Map(
      stagePreview(painted, 'baum', 'erfasst', ALL_ROLES, 'de').buttons.map((x) => [x.key, x.color]),
    );
    expect(by.get(a)).toBe('var(--destructive)');
    expect(by.get(b)).toBe('#aa0000');
    expect(by.get(c)).toBeUndefined();
  });
});

describe('automatic actions in the preview bar (C-004 step 1)', () => {
  const meldung = () => goldenDoc('maengelmelder', '1.0.0');

  it("an automatic action's own task is no button", () => {
    const keys = stagePreview(meldung().effective(), 'meldung', 'offen', ALL_ROLES, 'de').buttons.map(
      (b) => b.key,
    );
    expect(keys).toContain('bewerten');
    expect(keys).not.toContain('eskalieren');
    expect(keys).not.toContain('benachrichtigen');
  });

  it('a system-only task no single automatic action owns is marked automatic and never dimmed', () => {
    const file = meldung()
      .apply({
        kind: 'add',
        path: 'tasks.eskalieren.auto.zweite',
        value: { after: 'melden' },
      })
      .doc.effective();
    const buttons = stagePreview(file, 'meldung', 'offen', 'melder', 'de').buttons;
    const auto = buttons.find((b) => b.key === 'eskalieren');
    expect(auto?.automatic).toBe(true);
    expect(auto?.dimmed).toBe(false);
    expect(buttons.filter((b) => b.automatic).map((b) => b.key)).toEqual(['eskalieren']);
  });
});
