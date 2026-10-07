// WP-636: what the action row shows for a task (button label, colour, icon, confirmation), which tasks edit in place,
// and what a quick edit submits.
import { describe, expect, it, vi } from 'vitest';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId, Key } from '@ueberblick/core/model';
import { quickEditInput } from './quick-edit';
import { quickEditProperties } from './quick-edit.svelte';
import { startTask } from './sheet-data';
import { buttonColor } from '@ueberblick/ui';
import { confirmTiming, presentTasks, submitConfirm } from './task-presentation';

const file = {
  tasks: {
    pflege: {
      label: { de: 'Pflege', en: 'Care' },
      on: 'baum',
      button: { label: { de: 'Pflegen', en: 'Care now' }, color: 'success', icon: 'leaf' },
      confirm: { de: 'Wirklich pflegen?', en: 'Really?' },
      form: { befund: {} },
      steps: [{ kind: 'form' }, { kind: 'location', property: 'lage' }],
    },
    bearbeiten: {
      label: { de: 'Bearbeiten' },
      on: 'baum',
      steps: [{ kind: 'quick_edit', properties: ['art'] }],
    },
    gemischt: {
      label: { de: 'Gemischt' },
      on: 'baum',
      steps: [
        { kind: 'quick_edit', properties: ['art'] },
        { kind: 'location', property: 'lage' },
      ],
    },
    nur_form: { label: { de: 'Befund' }, on: 'baum', form: { befund: {} } },
    einzeln: { label: { de: 'Einzeln' }, on: 'baum', confirm: { de: 'Sicher?' }, then: [] },
    knopf: { label: { de: 'Knopf' }, on: 'baum', then: [] },
    rot: { label: { de: 'Rot' }, on: 'baum', button: { color: '#aa0000' } },
  },
} as unknown as CompiledConfig['file'];
const config = { file } as unknown as CompiledConfig;
const choice = (key: string, label = key) => ({ key: key as Key, label });

describe('presentTasks', () => {
  it('lays the button label, colour, icon and confirmation of the project file over the task', () => {
    const [t] = presentTasks([choice('pflege', 'Pflege')], file, 'de');
    expect(t).toEqual({ key: 'pflege', label: 'Pflegen', color: '#16a34a', icon: 'leaf' });
  });
  it('speaks the language of the person', () => {
    const [t] = presentTasks([choice('pflege')], file, 'en');
    expect(t?.label).toBe('Care now');
    expect(submitConfirm(file, 'pflege' as Key, 'en')).toBe('Really?');
  });
  // WP-730 (B-023): a task with several steps asks at Absenden, a task without steps asks on the tap
  it('a task with several steps asks at the submit: the tap does not ask, the flow gets the text', () => {
    expect(confirmTiming(file, 'pflege' as Key)).toBe('submit');
    expect(presentTasks([choice('pflege')], file, 'de')[0]?.confirm).toBeUndefined();
    expect(submitConfirm(file, 'pflege' as Key, 'de')).toBe('Wirklich pflegen?');
  });
  it('a task without steps asks on the tap and the flow asks nothing', () => {
    expect(confirmTiming(file, 'einzeln' as Key)).toBe('tap');
    expect(presentTasks([choice('einzeln')], file, 'de')[0]?.confirm).toBe('Sicher?');
    expect(submitConfirm(file, 'einzeln' as Key, 'de')).toBeUndefined();
  });
  it('quick edit + location (baum_bearbeiten) asks at the submit', () => {
    expect(confirmTiming(file, 'gemischt' as Key)).toBe('submit');
  });
  it('a task without a button keeps its label and the plain button', () => {
    const [t] = presentTasks([choice('knopf', 'Knopf')], file, 'de');
    expect(t).toEqual({ key: 'knopf', label: 'Knopf' });
  });
  it('a hex colour is taken as given; the neutral one is the plain button', () => {
    expect(presentTasks([choice('rot')], file, 'de')[0]?.color).toBe('#aa0000');
    expect(buttonColor('neutral')).toBeUndefined();
    expect(buttonColor('danger')).toBe('var(--destructive)');
  });
});

describe('startTask', () => {
  const run = async (task: string) => {
    const submit = vi.fn(async () => 'queued' as const);
    const result = await startTask(
      { config, submitter: { submit, outcome: () => () => undefined }, ids: { runId: () => 'r1' as never } },
      task as Key,
      'f1' as FeatureId,
    );
    return { result, submit };
  };
  it('a form + location task goes to the task sheet', async () =>
    expect((await run('pflege')).result).toBe('form'));
  it('a task whose only step is a quick edit edits in place', async () => {
    const { result, submit } = await run('bearbeiten');
    expect(result).toBe('quick_edit');
    expect(submit).not.toHaveBeenCalled();
  });
  it('a quick edit among other steps is a step of the task sheet', async () =>
    expect((await run('gemischt')).result).toBe('form'));
  it('a task with a form only still goes to the task sheet', async () =>
    expect((await run('nur_form')).result).toBe('form'));
  it('a task without a form submits at once', async () => {
    const { result, submit } = await run('knopf');
    expect(result).toBe('submitted');
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe('quick edit', () => {
  it('knows its picked properties only for a pure quick-edit task', () => {
    expect(quickEditProperties({ config }, 'bearbeiten' as Key)).toEqual(['art']);
    expect(quickEditProperties({ config }, 'gemischt' as Key)).toBeUndefined();
    expect(quickEditProperties({ config }, 'nur_form' as Key)).toBeUndefined();
  });

  const picked = ['art', 'hoehe'] as Key[];
  const current = { art: 'Linde', hoehe: 12, befund: 'gesund' };
  it('submits only the picked properties that changed', () => {
    expect(quickEditInput(picked, current, { art: 'Eiche', hoehe: 12, befund: 'x' })).toEqual({
      art: 'Eiche',
    });
  });
  it('an emptied value is an explicit null, so it clears', () => {
    expect(quickEditInput(picked, current, { art: '', hoehe: null as never })).toEqual({
      art: null,
      hoehe: null,
    });
  });
  it('nothing changed: nothing to submit', () => {
    expect(quickEditInput(picked, current, { art: 'Linde', hoehe: 12 })).toEqual({});
  });
  it('emptying a property that has no value writes nothing', () => {
    expect(quickEditInput(picked, { art: 'Linde' }, { hoehe: '' })).toEqual({});
  });
});
