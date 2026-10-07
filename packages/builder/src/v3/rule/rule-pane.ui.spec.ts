// @vitest-environment jsdom
// WP-377: the rule pane inside the builder frame, one test per acceptance box and per ported v3 element.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { splitAutoId, type AutoEntry } from '@ueberblick/core';
import '../task/shims.testing';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from '../task';
import { registerRulePane } from './index';
import { createRuleOps } from './ops';

afterEach(cleanup);

const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

const pathOf = (id: string): string => {
  const { task, name } = splitAutoId(id);
  return `tasks.${task}.auto.${name}`;
};
const entryOf = (doc: Doc, id: string): AutoEntry | undefined => {
  const { task, name } = splitAutoId(id);
  return doc.effective().tasks?.[task]?.auto?.[name];
};

function open(doc: Doc = clean()) {
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  registerRulePane(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  const select = async (rule: string) =>
    userEvent.click(document.querySelector(`[data-path="${pathOf(rule)}"]`) as HTMLElement);
  const last = (): Doc => onchange.mock.calls.at(-1)?.[0] as Doc;
  return { select, last, onchange };
}

const tab = (name: string) => screen.getByRole('tab', { name });
const RULE = 'massnahme_anlegen.massnahme_bei_schaden';

/** The doc after "Regel hinzufügen": a rule with its own task, selected. */
async function addRule() {
  const h = open();
  await userEvent.click(screen.getByRole('button', { name: 'Automatisch' }));
  const id = () => screen.getByTestId('rule-pane').dataset['rule'] ?? '';
  const rule = () => entryOf(h.last(), id());
  return { h, rule, id };
}

describe('the pane and its header', () => {
  it('a selected rule opens the pane with the same two sections as a task: Bedingung first, Ergebnis (no Wer)', async () => {
    const h = open();
    expect(screen.queryByTestId('rule-pane')).toBeNull();
    await h.select(RULE);
    expect(screen.getByTestId('rule-pane').dataset['rule']).toBe(RULE);
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Bedingung', 'Ergebnis']);
    expect(tab('Bedingung').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('rule-key').textContent).toBe(RULE);
    expect((screen.getByTestId('rule-name') as HTMLInputElement).value).toBe('');
  });

  it('"Schlüssel kopieren" puts the key on the clipboard', async () => {
    const h = open();
    await h.select(RULE);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByTestId('rule-copy-key'));
    expect(writeText).toHaveBeenCalledWith(RULE);
    await waitFor(() =>
      expect(screen.getByTestId('rule-copy-key').textContent).toContain('Schlüssel kopiert'),
    );
  });

  it('the name is written to the rule in the Doc', async () => {
    const h = open();
    await h.select(RULE);
    const name = screen.getByTestId('rule-name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Maßnahme bei Schaden');
    await userEvent.tab();
    expect(entryOf(h.last(), RULE)?.label).toEqual({ de: 'Maßnahme bei Schaden' });
  });

  it('"Automatische Aktion löschen" asks first and then takes the rule out; a shared task stays', async () => {
    const h = open();
    await h.select(RULE);
    await userEvent.click(screen.getByTestId('rule-delete'));
    expect(screen.getByTestId('confirm-delete')).toBeTruthy();
    expect(h.onchange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('confirm-delete-action'));
    expect(entryOf(h.last(), RULE)).toBeUndefined();
    expect(h.last().effective().tasks?.['massnahme_anlegen']).toBeDefined();
    expect(screen.queryByTestId('rule-pane')).toBeNull();
  });
});

describe('Regel hinzufügen', () => {
  it('the catalog chip adds a task with one valid automatic action with v3 default trigger, and opens it', async () => {
    const before = clean().problems().length;
    const { h, rule, id } = await addRule();
    expect(screen.getByTestId('rule-pane')).toBeTruthy();
    expect(rule()?.after).toBe('erfassen');
    expect(h.last().problems().length).toBe(before);
    const made = h.last().effective().tasks?.[splitAutoId(id()).task];
    expect(made).toMatchObject({ on: 'baum' });
    expect(made?.who).toBeUndefined(); // no `who`: only the system runs it
    expect(document.querySelector(`[data-path="${pathOf(id())}"]`)).not.toBeNull();
  });
});

describe('Auslöser', () => {
  it('changing the trigger kind and its fields writes the rule', async () => {
    const { h, rule } = await addRule();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'elapsed');
    expect(rule()?.elapsed).toEqual({ from: 'self.$created_at', after: 'days(7)' });
    expect(rule()?.after).toBeUndefined();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-since'), 'changed');
    const after = screen.getByTestId('rule-trigger-after');
    await userEvent.clear(after);
    await userEvent.type(after, '30');
    await userEvent.tab();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-unit'), 'months');
    expect(rule()?.elapsed).toEqual({ from: 'self.$changed_at', after: 'months(30)' });
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'transition');
    expect(rule()?.change).toBe('baum.stage');
    expect(rule()?.elapsed).toBeUndefined();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-to'), 'massnahme');
    expect(rule()?.when).toBe("self.stage == 'massnahme'");
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'change');
    await userEvent.click(screen.getByTestId('rule-watch-vitalitaet'));
    expect(rule()?.change).toBe('baum.vitalitaet');
    expect(rule()?.when).toBeUndefined();
    expect(h.last().problems().length).toBe(clean().problems().length);
  });

  it('a cron that core refuses shows the reason in place and is not written', async () => {
    const { rule } = await addRule();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'schedule');
    expect(rule()?.schedule).toBe('0 2 * * *');
    expect(rule()?.idle).toBe('days(0)');
    expect(screen.getByTestId('rule-cron-next').textContent).toContain('Nächste Ausführung');
    const cron = screen.getByTestId('rule-trigger-cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '99 2 * * *');
    expect(screen.getByTestId('rule-cron-error')).toBeTruthy();
    expect(rule()?.schedule).toBe('0 2 * * *');
  });

  it('"Nur wenn inaktiv ≥ Tage" on a schedule writes `idle`; 0 or empty writes days(0), every Objekt (WP-469)', async () => {
    const { rule } = await addRule();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'schedule');
    const idle = screen.getByTestId('rule-trigger-idle') as HTMLInputElement;
    expect(screen.getByText('Nur wenn inaktiv ≥ Tage')).toBeTruthy();
    await userEvent.type(idle, '14');
    await userEvent.tab();
    expect(rule()).toMatchObject({ schedule: '0 2 * * *', idle: 'days(14)' });
    // the cron edit keeps the idle days
    const cron = screen.getByTestId('rule-trigger-cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 5 * * *');
    expect(rule()).toMatchObject({ schedule: '0 5 * * *', idle: 'days(14)' });
    await userEvent.clear(idle);
    await userEvent.tab();
    expect(rule()?.schedule).toBe('0 5 * * *');
    expect(rule()?.idle).toBe('days(0)');
  });

  it('"In Phase" on a schedule writes and reads the when pin and keeps the other Bedingung rows (WP-480)', async () => {
    const { rule } = await addRule();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'schedule');
    const pick = screen.getByTestId('rule-trigger-schedule-stage') as HTMLSelectElement;
    expect(pick.value).toBe('');
    await userEvent.selectOptions(pick, 'massnahme');
    expect(rule()?.schedule).toBe('0 2 * * *');
    expect(rule()?.when).toBe("self.stage == 'massnahme'");
    // a cron edit keeps the pin
    const cron = screen.getByTestId('rule-trigger-cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 5 * * *');
    expect(rule()?.when).toBe("self.stage == 'massnahme'");
    await userEvent.selectOptions(pick, '');
    expect(rule()?.when).toBeUndefined();
  });

  it('a hand-written trigger is shown, not lost', async () => {
    const doc = clean();
    const path = pathOf(RULE);
    const set = doc.apply({
      kind: 'set',
      path: `${path}.elapsed`,
      value: { from: 'self.$created_at', after: 'days(3)', offset: '-days(1)' },
    }).doc;
    const written = set.apply({ kind: 'hide', path: `${path}.after` }).doc;
    const h = open(written);
    await h.select(RULE);
    expect(screen.getByTestId('rule-trigger-custom')).toBeTruthy();
    expect(h.onchange).not.toHaveBeenCalled();
  });
});

describe('WP-438: the trigger choices of the engine', () => {
  it('"Wenn Bedingungen zutreffen" is edited with the rows and written as the entry `when`, with no timing key', async () => {
    const { h, rule } = await addRule();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'when');
    expect(typeof rule()?.when).toBe('string');
    expect(rule()?.after).toBeUndefined();
    expect(screen.getByTestId('rule-trigger-when')).toBeTruthy();
    // the Bedingung section shows the trigger's rows and then the condition's: the first are the trigger's
    await userEvent.click(
      within(screen.getByTestId('rule-trigger-when')).getByRole('button', { name: /Bedingung hinzufügen/ }),
    );
    expect(rule()?.when).toMatch(/&&/);
    expect(h.last().problems().length).toBe(clean().problems().length);
    // the Bedingung tab has no rows of its own for it: the condition is the one `when`
    await userEvent.click(tab('Bedingung'));
    expect(screen.getByTestId('rule-cond-edge')).toBeTruthy();
    await userEvent.click(tab('Bedingung'));
    // another kind replaces it
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'create');
    expect(rule()?.after).toBe('erfassen');
  });

  it('"Nach" in Stunden and "Seit: betritt Phase" with "In Phase"', async () => {
    const { h, rule } = await addRule();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'elapsed');
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-unit'), 'hours');
    expect(rule()?.elapsed).toEqual({ from: 'self.$created_at', after: 'hours(7)' });
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-since'), 'entered');
    expect(rule()?.elapsed).toEqual({ from: "changed_at('stage')", after: 'hours(7)' });
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-entered-stage'), 'massnahme');
    expect(rule()?.when).toBe("self.stage == 'massnahme'");
    // back to "zuletzt geändert" drops the phase pin
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-since'), 'changed');
    expect(rule()?.when).toBeUndefined();
    expect(screen.queryByTestId('rule-trigger-entered-stage')).toBeNull();
    expect(h.last().problems().length).toBe(clean().problems().length);
  });

  it('a rule written in the Code view with these shapes shows the matching choice', async () => {
    const elapsed = { from: 'changed_at("stage")', after: 'days(2)' };
    const set = clean().apply({ kind: 'set', path: `${pathOf(RULE)}.elapsed`, value: elapsed }).doc;
    const written = set.apply({ kind: 'hide', path: `${pathOf(RULE)}.after` }).doc;
    const h = open(written);
    await h.select(RULE);
    expect((screen.getByTestId('rule-trigger-since') as HTMLSelectElement).value).toBe('entered');
    expect((screen.getByTestId('rule-trigger-unit') as HTMLSelectElement).value).toBe('days');
    expect(h.onchange).not.toHaveBeenCalled();
  });
});

describe('Bedingung', () => {
  it('a condition row is written to the entry and keeps the trigger parts', async () => {
    const { h, rule } = await addRule();
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'transition');
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-to'), 'massnahme');
    await userEvent.click(tab('Bedingung'));
    await userEvent.click(screen.getByRole('button', { name: /Bedingung hinzufügen/ }));
    await waitFor(() => expect(rule()?.when).toMatch(/^self\.stage == 'massnahme' && /));
    // Back on the Auslöser tab the trigger still reads as set.
    await userEvent.click(tab('Bedingung'));
    expect((screen.getByTestId('rule-trigger-to') as HTMLSelectElement).value).toBe('massnahme');
    expect(h.last().problems().length).toBe(clean().problems().length);
  });
});

describe('Schritte', () => {
  it('a rule with its own task edits that task`s steps with the Ergebnisse list', async () => {
    const { h, id } = await addRule();
    await userEvent.click(tab('Ergebnis'));
    expect(screen.getByTestId('rule-own-note')).toBeTruthy();
    await userEvent.click(screen.getByTestId('add-set'));
    const { task: run, name } = splitAutoId(id());
    expect(h.last().effective().tasks?.[run]?.then?.length).toBe(1);
    // The file round-trips: the saved overlay reads back to the same rule, task and step.
    const saved = h.last().saveIf(h.last().revision);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const again = openProject(musterstadt.templateSrc, saved.overlaySrc).effective();
    expect(again.tasks?.[run]?.auto?.[name]).toEqual(h.last().effective().tasks?.[run]?.auto?.[name]);
    expect(again.tasks?.[run]).toEqual(h.last().effective().tasks?.[run]);
  });

  it('a rule that runs a shared task shows the task and "Aufgabe öffnen"; its values are the task\'s outcome', async () => {
    const h = open();
    await h.select(RULE);
    await userEvent.click(tab('Ergebnis'));
    expect(screen.queryByTestId('rule-own-note')).toBeNull();
    expect(screen.getByTestId('rule-run-task').textContent).toBe('Maßnahme anlegen');
    expect(screen.queryByTestId('rule-with-row')).toBeNull(); // no `with`: values come from the task's `then.set`
    await userEvent.click(screen.getByTestId('rule-open-task'));
    expect(screen.getByTestId('task-pane').dataset['task']).toBe('massnahme_anlegen');
  });
});

describe('steps the editor cannot edit', () => {
  it('a step with a target (`redact.of`) is shown read-only and is still there after other edits', async () => {
    const base = clean();
    const made = createRuleOps(base.effective(), { type: 'baum', stage: 'stage' }, 'de', { rule: 'Löschen' });
    let doc = base;
    for (const op of made.ops) doc = doc.apply(op).doc;
    const run = splitAutoId(made.select.id ?? '').task;
    const then = [{ redact: { subject: 'actor', of: 'self.$created_by' } }];
    doc = doc.apply({ kind: 'set', path: `tasks.${run}.then`, value: then }).doc;
    const h = open(doc);
    await h.select(made.select.id ?? '');
    await userEvent.click(tab('Ergebnis'));
    expect(screen.getByTestId('outcomes').textContent).toContain('Personenbezogene Werte löschen');
    await userEvent.click(tab('Bedingung'));
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'schedule');
    expect(h.last().effective().tasks?.[run]?.then).toEqual(then);
    const saved = h.last().saveIf(h.last().revision);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      const again = openProject(musterstadt.templateSrc, saved.overlaySrc).effective();
      expect(again.tasks?.[run]?.then).toEqual(then);
    }
  });

  it('a step with an `of` target (WP-374) is shown and not lost on save', async () => {
    const base = clean();
    const made = createRuleOps(base.effective(), { type: 'baum', stage: 'stage' }, 'de', {
      rule: 'Archivieren',
    });
    let doc = base;
    for (const op of made.ops) doc = doc.apply(op).doc;
    const run = splitAutoId(made.select.id ?? '').task;
    const then = [{ lifecycle: 'archived', of: 'self.kinder' }];
    doc = doc.apply({ kind: 'set', path: `tasks.${run}.then`, value: then }).doc;
    const h = open(doc);
    await h.select(made.select.id ?? '');
    await userEvent.click(tab('Ergebnis'));
    expect(screen.getByTestId('rule-step-targets').textContent).toContain('self.kinder');
    await userEvent.click(tab('Bedingung'));
    await userEvent.selectOptions(screen.getByTestId('rule-trigger-kind'), 'schedule');
    const saved = h.last().saveIf(h.last().revision);
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(openProject(musterstadt.templateSrc, saved.overlaySrc).effective().tasks?.[run]?.then).toEqual(
        then,
      );
    }
  });
});
