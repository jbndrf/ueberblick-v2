// @vitest-environment jsdom
// WP-623: v3's feature sheet. Peek first, then full; header, action row, Aktivität and Daten tabs.
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId, FeatureType, FoldedFeature, Key } from '@ueberblick/core/model';
import { buildFeatureSheetModel, buildFormModel, type FeatureSheetModel } from '@ueberblick/ui';
import '@ueberblick/ui/testing';
import FeatureSheet from './FeatureSheet.svelte';

afterEach(cleanup);
beforeEach(() => {
  window.innerWidth = 480; // a phone: the bottom sheet with its peek height
});

const type: FeatureType = {
  label: { de: 'Baum', en: 'Tree' },
  geometry: 'lage',
  properties: {
    beschreibung: { type: 'text', required: true, label: { de: 'Beschreibung', en: 'Description' } },
    hoehe: { type: 'number', label: { de: 'Höhe', en: 'Height' } },
    zustand: { type: 'select', label: 'Zustand', options: { gut: { de: 'Gut' } } },
    foto: { type: 'file', label: { de: 'Foto', en: 'Photo' } },
    lage: { type: 'geometry', label: 'Lage' },
  },
};
const feature = {
  id: 't1' as FeatureId,
  type: 'baum' as Key,
  deleted: false,
  updatedSeq: 1,
  properties: {
    beschreibung: 'Alte Eiche',
    hoehe: 12,
    zustand: 'gut',
    foto: [
      { sha256: 'a'.repeat(64), name: 'krone.jpg', mime: 'image/jpeg' },
      { sha256: 'b'.repeat(64), name: 'stamm.jpg', mime: 'image/jpeg' },
    ],
  },
  derived: {},
} as unknown as FoldedFeature;

function model(over: Partial<Parameters<typeof buildFeatureSheetModel>[0]> = {}): FeatureSheetModel {
  return buildFeatureSheetModel({
    feature,
    type,
    types: { baum: type },
    availableTasks: ['kontrolle' as Key, 'melden' as Key],
    taskLabels: { kontrolle: { de: 'Kontrolle' }, melden: { de: 'Melden' } },
    edgesOut: [],
    edgesIn: [],
    activity: [],
    lookups: { participant: () => undefined, feature: () => undefined },
    locale: 'de',
    ...over,
  });
}

const NOW = '2026-10-01T12:00:00Z';
function open(m: FeatureSheetModel = model(), locale: 'de' | 'en' = 'de') {
  const onclose = vi.fn();
  const onstart = vi.fn();
  const onopen = vi.fn();
  const view = render(FeatureSheet, { open: true, model: m, locale, now: NOW, onclose, onstart, onopen });
  return { onclose, onstart, onopen, ...view };
}

describe('peek and header', () => {
  it('opens at peek height; a tap on the header takes it to full and back', async () => {
    open();
    const sheet = screen.getByTestId('feature-sheet');
    expect(sheet.getAttribute('data-state')).toBe('peek');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Objekt vergrößern oder verkleinern' }));
    expect(sheet.getAttribute('data-state')).toBe('full');
    await user.click(screen.getByRole('button', { name: 'Objekt vergrößern oder verkleinern' }));
    expect(sheet.getAttribute('data-state')).toBe('peek');
  });

  it('the heading is the Objektart; the subtitle is the display name and, when known, how long ago', () => {
    open(model({ updatedAt: '2026-10-01T10:00:00Z' }));
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Baum');
    expect(screen.getByTestId('feature-sheet-subtitle').textContent).toBe('Alte Eiche · vor 2 Std');
  });

  it('without a last-changed time the subtitle is the display name only', () => {
    open();
    expect(screen.getByTestId('feature-sheet-subtitle').textContent).toBe('Alte Eiche');
  });

  it('the close button and Escape close the sheet', async () => {
    const { onclose } = open();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Schließen' }));
    await user.keyboard('{Escape}');
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  it("the dialog is named by the feature's own name, and focus returns to what opened it", () => {
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    const { unmount } = open();
    const dialog = screen.getByRole('dialog', { name: 'Alte Eiche' });
    expect(document.activeElement).toBe(dialog);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('action row', () => {
  it('has one button per available task, in order; a tap starts that task', async () => {
    const { onstart } = open();
    const row = screen.getByRole('group', { name: 'Aufgaben' });
    const buttons = within(row).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Kontrolle', 'Melden']);
    await userEvent.setup().click(buttons[1] as HTMLElement);
    expect(onstart).toHaveBeenCalledWith('melden');
  });

  it("a task with a colour wears the admin's colour, the others the default button", () => {
    const base = model();
    const coloured: FeatureSheetModel = {
      ...base,
      tasks: [
        { ...(base.tasks[0] as (typeof base.tasks)[number]), color: '#16a34a' },
        base.tasks[1] as (typeof base.tasks)[number],
      ],
    };
    open(coloured);
    const [a, b] = within(screen.getByRole('group', { name: 'Aufgaben' })).getAllByRole('button');
    expect((a as HTMLElement).style.getPropertyValue('--btn-color')).toBe('#16a34a');
    expect((b as HTMLElement).style.getPropertyValue('--btn-color')).toBe('');
  });

  it('no row without tasks', () => {
    open(model({ availableTasks: [] }));
    expect(screen.queryByRole('group', { name: 'Aufgaben' })).toBeNull();
  });
});

describe('tabs', () => {
  it("start on Aktivität, which shows v3's empty state until the timeline arrives", () => {
    open();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
    expect(tabs).toEqual(['Aktivität', 'Daten']);
    expect(screen.getByRole('tab', { name: 'Aktivität' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Noch keine Aktivität')).toBeTruthy();
  });

  it('does not build the Daten panel while the sheet opens on Aktivität', async () => {
    const view = open();
    // bits-ui's Tabs.Content renders inactive panels with `hidden`, so a plain render of the DataTab
    // would cost the open (R14); the panel's content may only be mounted once Daten is tapped.
    expect(view.baseElement.querySelector('[data-testid="daten-property"]')).toBeNull();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Daten' }));
    expect(view.baseElement.querySelectorAll('[data-testid="daten-property"]')).not.toHaveLength(0);
  });

  it('Daten lists the readable properties in the given order with their values', async () => {
    open();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Daten' }));
    const labels = screen.getAllByRole('term').map((t) => t.textContent);
    expect(labels).toEqual(['Beschreibung', 'Höhe', 'Zustand', 'Foto', 'Lage']);
    const values = screen.getAllByRole('definition').map((d) => d.textContent?.trim());
    expect(values.slice(0, 4)).toEqual(['Alte Eiche', '12', 'Gut', 'krone.jpg  stamm.jpg']);
  });

  it('a feature with no properties to show says so', async () => {
    open(model({ properties: [] }));
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Daten' }));
    expect(screen.getByText('Noch keine Daten')).toBeTruthy();
  });

  it('English locale uses the English strings', () => {
    open(model({ locale: 'en' }), 'en');
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Data' })).toBeTruthy();
    expect(screen.getByText('No activity yet')).toBeTruthy();
  });
});

describe('accessibility', () => {
  it('the open sheet has no axe violations on either tab', async () => {
    const { baseElement } = open();
    const run = async () =>
      (await axe.run(baseElement, { rules: { 'color-contrast': { enabled: false } } })).violations.map(
        (v) => `${v.id}: ${v.help}`,
      );
    expect(await run()).toEqual([]);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Daten' }));
    expect(await run()).toEqual([]);
  });
});

describe('inline quick edit (WP-636)', () => {
  function editing() {
    const edit = {
      title: 'Bearbeiten',
      fields: buildFormModel({ form: { beschreibung: {} }, properties: type.properties }).fields,
      choices: {},
      host: {},
      values: { beschreibung: 'Alte Eiche' },
      saving: false,
      set: vi.fn(),
      cancel: vi.fn(),
      save: vi.fn(),
    };
    const onsave = vi.fn();
    const view = render(FeatureSheet, {
      open: true,
      model: model(),
      locale: 'de',
      now: NOW,
      onclose: vi.fn(),
      onstart: vi.fn(),
      onopen: vi.fn(),
      quickEdit: edit as never,
      onsave,
    });
    return { edit, onsave, ...view };
  }

  it('opens on Daten with the task label as heading, the picked property as an input and the rest as text', () => {
    editing();
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Bearbeiten');
    expect(screen.getByRole('tab', { name: 'Daten' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText(/Beschreibung/) as HTMLInputElement).value).toBe('Alte Eiche');
    expect(screen.queryByLabelText(/Höhe/)).toBeNull();
    expect(screen.getByText('Höhe')).toBeTruthy();
  });

  it('the action row is Abbrechen and Speichern', async () => {
    const { edit, onsave } = editing();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onsave).toHaveBeenCalledTimes(1);
    expect(edit.cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Kontrolle' })).toBeNull();
  });
});

describe('the header menu: "Im Chat erwähnen" (v3 DetailModule.svelte (the feature detail module):485-492, 1115-1139)', () => {
  function withMention(over: Record<string, unknown> = {}, locale: 'de' | 'en' = 'de') {
    const onmention = vi.fn();
    const view = render(FeatureSheet, {
      open: true,
      model: model(),
      locale,
      now: NOW,
      onclose: vi.fn(),
      onstart: vi.fn(),
      onopen: vi.fn(),
      onmention,
      ...over,
    });
    return { onmention, ...view };
  }
  async function openMenu(name = 'Weitere Aktionen'): Promise<void> {
    screen.getByRole('button', { name }).focus();
    await userEvent.keyboard('{Enter}');
  }
  const item = async (): Promise<HTMLElement> => {
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    const hit = items.find((i) => /Im Chat erwähnen|Mention in chat/.test(i.textContent ?? ''));
    if (hit === undefined) throw new Error('no chat item');
    return hit;
  };
  afterEach(() => document.body.removeAttribute('style'));

  it('has a ⋮ button "Weitere Aktionen" in the header with the one item "Im Chat erwähnen"; a tap mentions this feature', async () => {
    const { onmention } = withMention();
    await openMenu();
    const it = await item();
    expect(it.textContent?.trim()).toBe('Im Chat erwähnen');
    await fireEvent.click(it);
    expect(onmention).toHaveBeenCalledTimes(1);
  });

  it('has no menu without the chat (a role without it, or a person who switched it off)', () => {
    withMention({ onmention: undefined });
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();
  });

  it('is hidden while a task form is open (v3: !activeModelTask)', () => {
    withMention({ form: (() => {}) as never });
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();
  });

  it('is hidden during a quick edit (v3: !isInlineEditing)', () => {
    withMention({
      quickEdit: {
        title: 'Bearbeiten',
        fields: buildFormModel({ form: { beschreibung: {} }, properties: type.properties }).fields,
        choices: {},
        host: {},
        values: { beschreibung: 'Alte Eiche' },
        saving: false,
        set: vi.fn(),
        cancel: vi.fn(),
        save: vi.fn(),
      } as never,
      onsave: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: 'Weitere Aktionen' })).toBeNull();
  });

  it('speaks English', async () => {
    withMention({}, 'en');
    await openMenu('More actions');
    expect((await item()).textContent?.trim()).toBe('Mention in chat');
  });

  it('has no axe violations with the menu button', async () => {
    withMention();
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
