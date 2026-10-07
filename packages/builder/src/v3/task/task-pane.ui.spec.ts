// @vitest-environment jsdom
// WP-336: the task pane inside the builder frame, one test per acceptance box and per ported v3 element.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import './shims.testing';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from './index';
import { parse } from 'yaml';

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@ueberblick/ui/components/ui/sonner', () => ({ toast: toasts }));

afterEach(cleanup);

/** The golden task `befund_ergaenzen` with the two-role `who` these tests drive (WP-410 narrowed the golden file to one role). */
const TWO_ROLES = (src: string): string => {
  const one = `    on: baum\n    who: [ kontrolle ]\n    form:\n      befund:`;
  if (!src.includes(one)) throw new Error('golden befund_ergaenzen changed: update this fixture patch');
  return src.replace(one, one.replace('[ kontrolle ]', '[ kontrolle, bauhof ]'));
};

const clean = (): Doc => openProject(TWO_ROLES(musterstadt.templateSrc), musterstadt.overlaySrc);

/** The frame with the task pane registered; returns the last document the frame held. */
function open(task: string, doc: Doc = clean()) {
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: 'baum', locale: 'de', registry, onchange });
  const select = async () =>
    userEvent.click(document.querySelector(`[data-path="tasks.${task}"]`) as HTMLElement);
  const last = (): Doc => onchange.mock.calls.at(-1)?.[0] as Doc;
  return { select, last, onchange };
}

const tab = (name: string) => screen.getByRole('tab', { name });

describe('the pane and its tabs', () => {
  it('a selected task opens the pane with the tabs of v3 and the C-004 sections Bedingung and Ergebnis (no Wer), Definition first', async () => {
    const h = open('kontrolle');
    expect(screen.queryByTestId('task-pane')).toBeNull();
    await h.select();
    expect(screen.getByTestId('task-pane').dataset['task']).toBe('kontrolle');
    expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
      'Definition',
      'Bedingung',
      'Formular',
      'Ergebnis',
      'YAML',
    ]);
    expect(tab('Definition').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('task-name').textContent).toBe('Regelkontrolle');
    expect(screen.getByTestId('task-key').textContent).toBe('kontrolle');
  });

  it('"Schlüssel kopieren" puts the key on the clipboard', async () => {
    const h = open('kontrolle');
    await h.select();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByTestId('task-copy-key'));
    expect(writeText).toHaveBeenCalledWith('kontrolle');
    await waitFor(() =>
      expect(screen.getByTestId('task-copy-key').textContent).toContain('Schlüssel kopiert'),
    );
  });
});

describe('Definition', () => {
  it('edits label and description in the Doc', async () => {
    const h = open('kontrolle');
    await h.select();
    const label = screen.getByTestId('task-label') as HTMLInputElement;
    await userEvent.clear(label);
    await userEvent.type(label, 'Jetzt prüfen');
    await userEvent.tab();
    expect(h.last().effective().tasks?.['kontrolle']?.label).toMatchObject({ de: 'Jetzt prüfen' });
    expect(screen.getByTestId('task-name').textContent).toBe('Jetzt prüfen');
    const description = screen.getByTestId('task-description');
    await userEvent.type(description, 'Sichtprüfung');
    await userEvent.tab();
    expect(h.last().effective().tasks?.['kontrolle']?.description).toEqual({ de: 'Sichtprüfung' });
  });

  it('an empty label is not written (the label is required)', async () => {
    const h = open('kontrolle');
    await h.select();
    const label = screen.getByTestId('task-label') as HTMLInputElement;
    await userEvent.clear(label);
    await userEvent.tab();
    expect(h.onchange).not.toHaveBeenCalled();
    expect(label.value).toBe('Regelkontrolle');
  });

  it('the phase the task is offered in writes a stage condition', async () => {
    const h = open('befund_ergaenzen');
    await h.select();
    await userEvent.selectOptions(screen.getByTestId('task-stage'), 'massnahme');
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.when).toBe("self.stage == 'massnahme'");
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.who).toEqual(['kontrolle', 'bauhof']);
    await userEvent.selectOptions(screen.getByTestId('task-stage'), '');
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.when).toBeUndefined();
  });

  it('"Einstiegs-Aufgabe" writes on and creates', async () => {
    const h = open('befund_ergaenzen');
    await h.select();
    await userEvent.click(screen.getByTestId('task-entry'));
    expect(h.last().effective().tasks?.['befund_ergaenzen']).toMatchObject({ on: '$map', creates: 'baum' });
    expect(screen.getByTestId('task-entry') as HTMLInputElement).toHaveProperty('checked', true);
  });
});

describe('Bedingungen', () => {
  it('adding and removing a condition row changes `when`', async () => {
    const h = open('befund_ergaenzen');
    await h.select();
    await userEvent.click(tab('Bedingung'));
    expect(screen.getByTestId('condition-rows').textContent).toContain('Immer verfügbar');
    await userEvent.click(screen.getByRole('button', { name: 'Bedingung hinzufügen' }));
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.when).toMatch(/^self\.\w+ == null$/);
    await userEvent.selectOptions(screen.getByLabelText('Feld von Vergleich 1'), 'self.befund');
    await userEvent.selectOptions(screen.getByLabelText('Vergleich 1'), '==');
    const right = screen.getByLabelText('Wert von Vergleich 1');
    await userEvent.type(right, 'aktiv');
    await userEvent.tab();
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.when).toBe("self.befund == 'aktiv'");
    await userEvent.click(screen.getByRole('button', { name: 'Vergleich 1 entfernen' }));
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.when).toBeUndefined();
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.who).toEqual(['kontrolle', 'bauhof']);
  });

  it('an operator change and a number value are written as the rule language says', async () => {
    const h = open('befund_ergaenzen');
    await h.select();
    await userEvent.click(tab('Bedingung'));
    await userEvent.click(screen.getByRole('button', { name: 'Bedingung hinzufügen' }));
    await userEvent.selectOptions(screen.getByLabelText('Feld von Vergleich 1'), 'self.hoehe_m');
    await userEvent.selectOptions(screen.getByLabelText('Vergleich 1'), '>');
    const right = screen.getByLabelText('Wert von Vergleich 1');
    await userEvent.clear(right);
    await userEvent.type(right, '3');
    await userEvent.tab();
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.when as string).toMatch(/self\.hoehe_m > 3$/);
    await userEvent.selectOptions(screen.getByLabelText('Vergleich 1'), 'empty');
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.when as string).toMatch(
      /self\.hoehe_m == null$/,
    );
  });

  it("a value of the wrong type shows the checker's problem in place and is not applied", async () => {
    const h = open('befund_ergaenzen');
    await h.select();
    await userEvent.click(tab('Bedingung'));
    await userEvent.click(screen.getByRole('button', { name: 'Bedingung hinzufügen' }));
    await userEvent.selectOptions(screen.getByLabelText('Feld von Vergleich 1'), 'self.hoehe_m');
    await userEvent.selectOptions(screen.getByLabelText('Vergleich 1'), '>');
    const before = h.onchange.mock.calls.length;
    const right = screen.getByLabelText('Wert von Vergleich 1');
    await userEvent.clear(right);
    await userEvent.type(right, 'hoch');
    await userEvent.tab();
    expect((await screen.findByTestId('condition-error')).textContent).toContain('Nicht übernommen');
    expect(h.onchange.mock.calls.length).toBe(before);
  });

  it('a condition the rows cannot say stays text; an invalid one shows the problem in place and is not applied', async () => {
    const odd = clean().apply({
      kind: 'set',
      path: 'tasks.zuweisen.when',
      value: "self.befund.contains('x') || actor.kind == 'admin'",
    }).doc;
    const h = open('zuweisen', odd);
    await h.select();
    await userEvent.click(tab('Bedingung'));
    const text = screen.getByLabelText('Bedingung als Text') as HTMLTextAreaElement;
    expect(text.value).toContain("actor.kind == 'admin'");
    await userEvent.clear(text);
    await userEvent.type(text, 'self.gibts_nicht > 3');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    const error = await screen.findByTestId('condition-error');
    expect(error.textContent?.length).toBeGreaterThan(5);
    expect(h.onchange).not.toHaveBeenCalled();
  });

  it('"Wer darf dies nutzen": two roles write the task\'s `who`', async () => {
    // Both roles may write `befund` here, or the checker would refuse the second one (task_role_cannot_write, WP-410).
    const both = clean().apply({
      kind: 'set',
      path: 'types.baum.permissions.write.befund',
      value: ['kontrolle', 'bauhof'],
    }).doc;
    const h = open('befund_ergaenzen', both);
    await h.select();
    await userEvent.click(tab('Bedingung'));
    const trigger = within(screen.getByRole('group', { name: 'Wer darf dies nutzen' })).getAllByRole(
      'button',
    )[0] as HTMLElement;
    // Start from none: remove both roles, then pick two.
    await userEvent.click(trigger);
    const list = await screen.findByRole('listbox');
    // Bauhof first: Baumkontrolle alone may write the form field, so it must stay until the last.
    for (const o of within(list).getAllByRole('option').reverse()) {
      if (o.getAttribute('aria-selected') === 'true') await userEvent.click(o);
    }
    expect(screen.queryByTestId('task-roles-error')?.textContent).toBeUndefined();
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.who).toBeUndefined();
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    const names = options.map((o) => o.textContent?.trim());
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of ['Baumkontrolle', 'Bauhof'])
      await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name }));
    expect(h.last().effective().tasks?.['befund_ergaenzen']?.who).toEqual(['kontrolle', 'bauhof']);
  });

  it('a task without `who` that has automatic actions shows "Automatisch"; Admin is a choice next to the roles', async () => {
    const doc = clean().apply({
      kind: 'set',
      path: 'tasks.nur_system',
      value: {
        label: { de: 'Nur System' },
        on: 'baum',
        auto: {
          a: { elapsed: { from: 'self.faellig_am' } },
          b: { elapsed: { from: 'self.faellig_am', after: 'days(1)' } },
        },
      },
    }).doc;
    const h = open('nur_system', doc);
    await h.select();
    await userEvent.click(tab('Bedingung'));
    expect(screen.getByTestId('task-nur_system-automatic').textContent).toBe('Automatisch');
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Wer darf dies nutzen' })).getAllByRole(
        'button',
      )[0] as HTMLElement,
    );
    await userEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Admin' }));
    expect(h.last().effective().tasks?.['nur_system']?.who).toEqual(['admin']);
    expect(screen.queryByTestId('task-nur_system-automatic')).toBeNull();
  });

  it("a role choice that leaves the task unusable shows the checker's reason in place and is not applied", async () => {
    const h = open('befund_ergaenzen');
    await h.select();
    await userEvent.click(tab('Bedingung'));
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Wer darf dies nutzen' })).getAllByRole(
        'button',
      )[0] as HTMLElement,
    );
    const kontrolle = within(await screen.findByRole('listbox')).getByRole('option', {
      name: /Baumkontrolle/,
    });
    await userEvent.click(kontrolle);
    expect((await screen.findByTestId('task-roles-error')).textContent).toContain('Nicht übernommen');
    expect(h.onchange).not.toHaveBeenCalled();
  });

  it('on a phone the picker opens as a full-screen sheet with "Fertig (n)", as in v3', async () => {
    const width = window.innerWidth;
    try {
      const h = open('befund_ergaenzen');
      await h.select();
      // The builder frame stays at its desktop layout; the picker reads the width when it draws (no resize event).
      Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
      await userEvent.click(tab('Bedingung'));
      await userEvent.click(
        within(screen.getByRole('group', { name: 'Wer darf dies nutzen' })).getAllByRole(
          'button',
        )[0] as HTMLElement,
      );
      const sheet = await screen.findByRole('dialog', { name: 'Wer darf dies nutzen' });
      expect(within(sheet).getByRole('button', { name: 'Fertig (2)' })).toBeTruthy();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Fertig (2)' }));
      expect(screen.queryByRole('dialog', { name: 'Wer darf dies nutzen' })).toBeNull();
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    }
  });

  it('a new role made in the picker is added to the file', async () => {
    const h = open('befund_ergaenzen');
    await h.select();
    await userEvent.click(tab('Bedingung'));
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Wer darf dies nutzen' })).getAllByRole(
        'button',
      )[0] as HTMLElement,
    );
    await userEvent.type(await screen.findByRole('textbox', { name: 'Suchen …' }), 'Gärtner Team');
    await userEvent.click(screen.getByRole('button', { name: /„Gärtner Team“ erstellen/ }));
    expect(h.last().effective().roles?.['gaertner_team']?.label).toEqual({ de: 'Gärtner Team' });
  });

  it('"Beliebige Instanz | Nur eigene" writes self.$created_by == actor.id and keeps roles and rows', async () => {
    const h = open('kontrolle');
    await h.select();
    await userEvent.click(tab('Bedingung'));
    const own = screen.getByRole('button', { name: 'Nur eigene' }) as HTMLButtonElement;
    expect(own.disabled).toBe(false);
    expect(own.getAttribute('aria-pressed')).toBe('false');
    const before = clean().effective().tasks?.['kontrolle']?.when;
    await userEvent.click(own);
    const when = h.last().effective().tasks?.['kontrolle']?.when ?? '';
    expect(when).toContain('self.$created_by == actor.id');
    expect(when).toContain(before ?? '');
    expect(h.last().problems()).toEqual(clean().problems());
    expect(screen.getByRole('button', { name: 'Nur eigene' }).getAttribute('aria-pressed')).toBe('true');
    // the clause is a switch, not a row
    expect(screen.queryByDisplayValue(/created_by/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Beliebiges Objekt' }));
    expect(h.last().effective().tasks?.['kontrolle']?.when).toBe(before);
  });
});

describe('delete', () => {
  it('asks first, lists the rules that run the task, removes it and clears the selection', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const h = open('kontrolle');
    await h.select();
    await user.click(screen.getByTestId('task-delete'));
    const dialog = await screen.findByTestId('confirm-delete');
    expect(dialog.textContent).toContain('Aufgabe „Regelkontrolle“ ausblenden?');
    expect(dialog.textContent).toContain('massnahme_bei_schaden');
    expect(h.onchange).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(h.onchange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('confirm-delete')).toBeNull());
    await user.click(screen.getByTestId('task-delete'));
    await user.click(await screen.findByTestId('confirm-delete-action'));
    const doc = h.last();
    expect(doc.effective().tasks?.['kontrolle']).toBeUndefined();
    expect(
      doc.problems().some((p) => p.path.startsWith('tasks.massnahme_anlegen.auto.massnahme_bei_schaden')),
    ).toBe(true);
    expect(screen.queryByTestId('task-pane')).toBeNull();
    // the dangling rule shows in the problems badge
    expect(Number(screen.getByTestId('problem-count').textContent)).toBeGreaterThan(0);
  });
});

describe('YAML', () => {
  it('"Formular kopieren" puts the form YAML on the clipboard and says so; it parses back to the same form (WP-440)', async () => {
    const h = open('kontrolle');
    await h.select();
    await userEvent.click(tab('YAML'));
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Formular kopieren' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = parse((writeText.mock.calls[0] as unknown as [string])[0]) as { form: unknown };
    expect(copied.form).toEqual(clean().effective().tasks?.['kontrolle']?.form);
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith('Formular kopiert'));
  });

  it('shows the task as YAML and applies an edit as overlay ops', async () => {
    const h = open('befund_ergaenzen');
    await h.select();
    await userEvent.click(tab('YAML'));
    const area = screen.getByTestId('task-yaml') as HTMLTextAreaElement;
    expect(area.value).toContain('label:');
    const next = area.value.replace('Befund ergänzen', 'Befund nachtragen');
    expect(next).not.toBe(area.value);
    await userEvent.clear(area);
    await userEvent.click(area);
    await userEvent.paste(next);
    await userEvent.click(screen.getByRole('button', { name: 'YAML anwenden' }));
    expect(JSON.stringify(h.last().effective().tasks?.['befund_ergaenzen']?.label)).toContain(
      'Befund nachtragen',
    );
  });

  it('bad YAML is reported and applies nothing', async () => {
    const h = open('befund_ergaenzen');
    await h.select();
    await userEvent.click(tab('YAML'));
    const area = screen.getByTestId('task-yaml') as HTMLTextAreaElement;
    await userEvent.clear(area);
    await userEvent.click(area);
    await userEvent.paste('label: [unclosed');
    await userEvent.click(screen.getByRole('button', { name: 'YAML anwenden' }));
    expect((await within(screen.getByTestId('task-pane')).findByRole('alert')).textContent).toContain(
      'Ungültiges YAML',
    );
    expect(h.onchange).not.toHaveBeenCalled();
  });
});
