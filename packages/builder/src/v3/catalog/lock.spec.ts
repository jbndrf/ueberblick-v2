import { describe, expect, it } from 'vitest';
import { openProject } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { checkOps } from '../../doc/entity-yaml';
import { createLocked, opsLocked } from './lock';
import { createOp, type NewNames } from './ops';

const names: NewNames = {
  task: 'Neue Aufgabe',
  entry: 'Neuer Eingang',
  stage: 'Neue Phase',
  rule: 'Neue Regel',
  process: 'Phase',
  endStage: 'Ende',
};
const doc = () => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

describe('catalog locks (WP-515)', () => {
  it('a stage create is locked where the template locks the stage options', () => {
    expect(createLocked(doc(), 'baum', { kind: 'node', node: 'stage' }, 'de', names)).toBe(true);
  });

  it('a task create is free', () => {
    expect(createLocked(doc(), 'baum', { kind: 'task', task: 'button' }, 'de', names)).toBe(false);
  });

  it('opsLocked matches a path inside or above a locked path, not a sibling', () => {
    const locked = musterstadt.templateSrc.replace('lock:\n', 'lock:\n  - rules\n');
    const d = openProject(locked, musterstadt.overlaySrc);
    expect(opsLocked(d, [{ kind: 'add', path: 'rules.x', value: {} }])).toBe(true);
    expect(opsLocked(d, [{ kind: 'add', path: 'tasks.x', value: {} }])).toBe(false);
  });

  // The owner rule (C-004): a lock stops changing what the template defines, not adding the project's own automatic action.
  describe('a locked task', () => {
    const locked = (task: string) =>
      openProject(
        musterstadt.templateSrc.replace('lock:\n', `lock:\n  - tasks.${task}\n`),
        musterstadt.overlaySrc,
      );
    const base = openProject(musterstadt.templateSrc, musterstadt.overlaySrc).effective();
    const withAuto = Object.entries(base.tasks ?? {}).find(([, t]) => t.auto !== undefined);
    const task = withAuto?.[0] ?? '';
    const other = Object.keys(base.tasks ?? {}).find((k) => k !== task) ?? '';
    const entry = Object.keys(withAuto?.[1].auto ?? {})[0];

    it('"Automatisch" stays enabled and its create is accepted', () => {
      const d = locked(task);
      expect(createLocked(d, 'baum', { kind: 'node', node: 'rule' }, 'de', names)).toBe(false);
      const made = createOp(d.effective(), 'baum', { kind: 'node', node: 'rule' }, 'de', names);
      expect(made.ok).toBe(true);
      if (made.ok) expect(checkOps(d, [made.op, ...(made.after ?? [])]).ok).toBe(true);
    });

    it('adding an own automatic action under it is free; changing a template entry is not', () => {
      const d = locked(task);
      const own = { kind: 'add', path: `tasks.${task}.auto.eigene`, value: { after: other } } as const;
      expect(opsLocked(d, [own])).toBe(false);
      expect(checkOps(d, [own]).ok).toBe(true);
      expect(opsLocked(d, [{ kind: 'set', path: `tasks.${task}.label`, value: {} }])).toBe(true);
      if (entry !== undefined)
        expect(opsLocked(d, [{ kind: 'hide', path: `tasks.${task}.auto.${entry}` }])).toBe(true);
    });
  });
});
