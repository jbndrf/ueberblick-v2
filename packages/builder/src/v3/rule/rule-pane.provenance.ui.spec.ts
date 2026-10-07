// @vitest-environment jsdom
// WP-454: provenance mark, reset and hide on the rule pane (as the task pane of WP-445).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../task/shims.testing';
import { splitAutoId } from '@ueberblick/core';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from '../task';
import { registerRulePane } from './index';

afterEach(cleanup);

const RULE = 'massnahme_anlegen.massnahme_bei_schaden';
const PATH = 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden';
const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function open(doc: Doc = clean(), rule = RULE) {
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  registerRulePane(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  const select = async () =>
    userEvent.click(document.querySelector(`[data-path="${pathOf(rule)}"]`) as HTMLElement);
  const last = (): Doc => onchange.mock.calls.at(-1)?.[0] as Doc;
  return { select, last };
}
const pathOf = (id: string): string => {
  const { task, name } = splitAutoId(id);
  return `tasks.${task}.auto.${name}`;
};
const mark = (): string | undefined =>
  screen.queryByTestId('provenance-mark')?.getAttribute('data-provenance') ?? undefined;

describe('provenance on the rule pane (WP-454)', () => {
  it('a template rule shows its mark and "Ausblenden" in place of "Automatische Aktion löschen", and hides it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const h = open();
    await h.select();
    expect(mark()).toBe(clean().provenance(PATH));
    expect(screen.getByTestId('rule-delete').textContent).toContain('Ausblenden');
    await user.click(screen.getByTestId('rule-delete'));
    const dialog = await screen.findByTestId('confirm-delete');
    expect(dialog.textContent).toContain('Automatische Aktion');
    expect(dialog.textContent).toContain('ausblenden?');
    expect(dialog.textContent).toContain('Die automatische Aktion bleibt in der Vorlage');
    await user.click(screen.getByTestId('confirm-delete-action'));
    expect(h.last().overlay().hide).toContain(PATH);
  });

  it('a changed rule offers "Auf Vorlage zurücksetzen", and the reset puts it back', async () => {
    const r = clean().apply({
      kind: 'set',
      path: `${PATH}.when`,
      value: "self.vitalitaet >= 'v4'",
    });
    if (r.refused !== undefined) throw new Error(r.refused.message);
    const h = open(r.doc);
    await h.select();
    expect(mark()).toBe('changed');
    await userEvent.click(screen.getByTestId('rule-reset'));
    expect(h.last().provenance(PATH)).toBe('template');
    expect(mark()).toBe('template');
    expect(screen.queryByTestId('rule-reset')).toBeNull();
  });

  it('a rule the template locks shows the lock with its reason and cannot be hidden', async () => {
    const src = musterstadt.templateSrc.replace(
      'lock:\n  - types.baum.properties.stage.options',
      `lock:\n  - types.baum.properties.stage.options\n  - ${PATH}`,
    );
    expect(src).not.toBe(musterstadt.templateSrc);
    const h = open(openProject(src, musterstadt.overlaySrc));
    await h.select();
    expect(screen.getByTestId('provenance-lock').getAttribute('title')).toContain(PATH);
    expect((screen.getByTestId('rule-delete') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a rule the project added is Hinzugefügt, with "Automatische Aktion löschen" and no reset', async () => {
    const doc = clean().apply({
      kind: 'add',
      path: 'tasks.befund_ergaenzen.auto.eigene_regel',
      value: { label: { de: 'Eigene' }, after: 'kontrolle' },
    });
    if (doc.refused !== undefined) throw new Error(doc.refused.message);
    const h = open(doc.doc, 'befund_ergaenzen.eigene_regel');
    await h.select();
    expect(mark()).toBe('added');
    expect(screen.queryByTestId('rule-reset')).toBeNull();
    expect(screen.getByTestId('rule-delete').textContent).toContain('Automatische Aktion löschen');
  });
});
