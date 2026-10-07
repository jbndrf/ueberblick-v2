// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { parse, stringify } from 'yaml';
import { embedGoldenSource } from '@ueberblick/core/testing';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import '@ueberblick/ui/testing';
import VersionsPage from './VersionsPage.svelte';
import type { PinMoveView } from '../../../../../../lib/admin/deploy/pin-move-view';
import type { ActionAnswer, VersionLine, VersionsCalls, VersionsPageData } from './types';

afterEach(cleanup);

const golden = resolve(import.meta.dirname, '../../../../../../../../../fixtures/golden');
const read = (rel: string): string => embedGoldenSource(readFileSync(resolve(golden, rel), 'utf8'));
const template = (v: string): TemplateFile => parse(read(`templates/baumkataster/${v}.yaml`)) as TemplateFile;
const overlay = parse(read('projects/musterstadt-baeume.yaml')) as OverlayFile;

const line = (version: number, status: string, over: Partial<VersionLine> = {}): VersionLine => ({
  version,
  status,
  objektarten: 2,
  createdAt: '2026-10-01T08:30:00Z',
  template: 'baumkataster',
  templateVersion: '1.1.0',
  ...over,
});
const three: VersionsPageData = {
  versions: [line(3, 'deployed'), line(2, 'retired'), line(1, 'retired')],
  upgrade: null,
};
const ok: ActionAnswer = { ok: true, version: 1, warnings: [] };

function calls(over: Partial<VersionsCalls> = {}): VersionsCalls {
  return {
    rollback: vi.fn(async () => ok),
    compare: vi.fn(async () => ({
      ok: true as const,
      plan: {
        entries: [{ path: 'types.baum.label', change: 'changed' as const, breaking: false }],
        entities: [
          {
            section: 'types',
            entity: 'baum',
            path: 'types.baum',
            changes: [{ path: 'types.baum.label', change: 'changed' as const, breaking: false }],
          },
        ],
        affected: [],
        breaking: [],
        mappings: [],
      },
    })),
    discard: vi.fn(async () => ok),
    upgrade: vi.fn(async () => ok),
    movePlan: vi.fn(async () => ({ ok: true as const, view: moveView })),
    movePins: vi.fn(async () => ({ ok: true as const, to: 3, unpinned: 3 })),
    ...over,
  } as VersionsCalls;
}
const OPT = 'types.baum.properties.stage.options.kontrolliert';
/** What the dry run answers for version 2: three Objekte hold the removed Phase "Kontrolliert". */
const moveView: PinMoveView = {
  from: 2,
  to: 3,
  pinned: 3,
  types: [{ type: 'baum', label: 'Baum', count: 3 }],
  plan: {
    revision: null,
    first: false,
    warnings: [],
    versions: [],
    blockers: [],
    groups: [
      {
        type: 'baum',
        label: 'Baum',
        isNew: false,
        isRemoved: false,
        objects: 3,
        entries: [
          { path: OPT, change: 'removed', breaking: true, affected: 3, name: 'Kontrolliert', stage: true },
        ],
      },
    ],
    mappings: [
      {
        path: OPT,
        name: 'Kontrolliert',
        type: 'baum',
        stage: true,
        affected: 3,
        choices: [{ key: 'erfasst', label: 'Erfasst' }],
      },
    ],
  },
};
const mount = (
  data: VersionsPageData = three,
  c: VersionsCalls = calls(),
  locale: 'de' | 'en' = 'de',
  pinned: Record<number, number> = {},
  onmoved: () => void = () => undefined,
) => render(VersionsPage, { locale, data, calls: c, pinned, onmoved });

describe('the list (v3 releases/+page.svelte:16-42)', () => {
  it('shows the History title, one row per version with v{n}, the Objektarten count and the date', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Versionen' })).toBeTruthy();
    const rows = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-version'));
    expect(rows.map((r) => r.getAttribute('data-version'))).toEqual(['3', '2', '1']);
    expect(within(rows[0] as HTMLElement).getByText('v3')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('2 Objektart(en)')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText(/2026/)).toBeTruthy();
  });

  it('marks the deployed version "aktiv" and offers Zurückrollen on the others only', () => {
    mount();
    const rows = screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-version'));
    expect(within(rows[0] as HTMLElement).getByText('aktiv')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: 'Zurückrollen' })).toBeNull();
    expect(within(rows[1] as HTMLElement).getByRole('button', { name: 'Zurückrollen' })).toBeTruthy();
  });

  it('with no version it says so (v3: "Noch keine Releases")', () => {
    mount({ versions: [], upgrade: null });
    expect(screen.getByText(/Noch keine Versionen/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Entwurf verwerfen' })).toBeNull();
  });

  it('speaks English', () => {
    mount(three, calls(), 'en');
    expect(screen.getByRole('heading', { level: 1, name: 'Versions' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Roll back' }).length).toBe(2);
  });

  it('has no axe violations,', async () => {
    const { container } = mount();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe('rollback', () => {
  it("asks in v3's AlertDialog first; Abbrechen calls nothing, Zurückrollen calls with the version", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const c = calls();
    mount(three, c);
    const row = screen.getAllByRole('listitem').find((li) => li.getAttribute('data-version') === '2');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Zurückrollen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Auf Version 2 zurückrollen?')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(c.rollback).not.toHaveBeenCalled();

    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Zurückrollen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zurückrollen' }),
    );
    expect(c.rollback).toHaveBeenCalledWith(2);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(await screen.findByText('Version 1 ist wieder aktiv.')).toBeTruthy();
  });

  it('a refused rollback shows the reason as an alert', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const c = calls({ rollback: vi.fn(async () => ({ ok: false as const, reason: 'mapping_required' })) });
    mount(three, c);
    await user.click(screen.getAllByRole('button', { name: 'Zurückrollen' })[0] as HTMLElement);
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Zurückrollen' }),
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/Zuordnung/);
  });
});

describe('compare', () => {
  it('two ticked versions enable Vergleichen and show the diff, older first', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const c = calls();
    mount(three, c);
    const compare = screen.getByRole('button', { name: 'Vergleichen' }) as HTMLButtonElement;
    expect(compare.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Version 3 zum Vergleichen auswählen' }));
    expect(compare.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Version 1 zum Vergleichen auswählen' }));
    expect(compare.disabled).toBe(false);
    await user.click(compare);
    expect(c.compare).toHaveBeenCalledWith(1, 3);
    expect(await screen.findByRole('heading', { name: 'Änderungen von v1 zu v3' })).toBeTruthy();
    expect(screen.getByText('types.baum.label')).toBeTruthy();
  });
});

describe('Entwurf verwerfen', () => {
  it('confirms in the dialog, then calls discard and says so', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const c = calls();
    mount(three, c);
    await user.click(screen.getByRole('button', { name: 'Entwurf verwerfen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(c.discard).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(c.discard).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Der Entwurf entspricht wieder der aktiven Version.')).toBeTruthy();
  });
});

describe('template upgrade offer', () => {
  const withOffer: VersionsPageData = {
    versions: [line(1, 'deployed')],
    upgrade: {
      offer: { from: '1.1.0', to: '2.0.0', template: template('2.0.0') },
      templateSrc: stringify(template('1.1.0')),
      overlaySrc: stringify(overlay),
      deployed: undefined,
      featureCounts: {},
    },
  };

  it('offers the newer version, asks for the conflict, then updates with the resolved overlay', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const c = calls();
    mount(withOffer, c);
    expect(screen.getByText('Vorlage baumkataster: Version 2.0.0 verfügbar')).toBeTruthy();
    const run = screen.getByRole('button', {
      name: 'Aktualisieren und veröffentlichen',
    }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(screen.getByText(/Einträge brauchen noch eine Wahl/)).toBeTruthy();
    const conflict = document.querySelector(
      '[data-path="types.baum.properties.vitalitaet.label"]',
    ) as HTMLElement;
    await user.click(within(conflict).getByRole('radio', { name: 'Meinen Wert behalten' }));
    // the new template removes a property: the breaking change needs a mapping before the update can run
    for (const select of screen.queryAllByRole('combobox'))
      await user.selectOptions(select, 'Werte verwerfen');
    await waitFor(() => expect(run.disabled).toBe(false));
    await user.click(run);
    expect(c.upgrade).toHaveBeenCalledTimes(1);
    const [text] = (c.upgrade as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(text).toContain('baumkataster@2');
  });

  it('shows no offer when there is none', () => {
    mount();
    expect(screen.queryByTestId('upgrade-offer')).toBeNull();
  });
});

describe('Auf aktuelle Version verschieben (WP-368, owner P3)', () => {
  const rowOf = (version: number) =>
    screen
      .getAllByRole('listitem')
      .find((li) => li.getAttribute('data-version') === String(version)) as HTMLElement;

  it('shows the pinned count and the button only on old versions with pinned Objekten', () => {
    mount(three, calls(), 'de', { 2: 3 });
    expect(within(rowOf(2)).getByTestId('pinned-count').textContent).toBe(
      '3 Objekte noch auf dieser Version',
    );
    expect(within(rowOf(2)).getByRole('button', { name: 'Auf aktuelle Version verschieben' })).toBeTruthy();
    expect(within(rowOf(1)).queryByTestId('pinned-count')).toBeNull();
    expect(within(rowOf(1)).queryByRole('button', { name: 'Auf aktuelle Version verschieben' })).toBeNull();
    expect(within(rowOf(3)).queryByRole('button', { name: 'Auf aktuelle Version verschieben' })).toBeNull();
  });

  it('shows no pinned count when nothing is pinned', () => {
    mount();
    expect(screen.queryByTestId('pinned-count')).toBeNull();
  });

  it('opens the mapping dialog with the counts, holds the confirm until answered, then moves', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const c = calls();
    const onmoved = vi.fn();
    mount(three, c, 'de', { 2: 3 }, onmoved);
    await user.click(within(rowOf(2)).getByRole('button', { name: 'Auf aktuelle Version verschieben' }));
    const dialog = await screen.findByTestId('pin-move');
    expect(c.movePlan).toHaveBeenCalledWith(2, 'de');
    expect((await within(dialog).findByTestId('pin-move-summary')).textContent).toContain(
      '3 Objekte wechseln von Version 2 auf Version 3.',
    );
    expect(within(dialog).getAllByText('3 Objekte betroffen').length).toBeGreaterThan(0);
    const confirm = within(dialog).getByRole('button', { name: 'Verschieben' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.selectOptions(within(dialog).getByRole('combobox'), 'Erfasst');
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    expect(c.movePins).toHaveBeenCalledWith(2, { [OPT]: { to: 'erfasst' } }, 'de');
    await waitFor(() => expect(onmoved).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('pin-move')).toBeNull());
  });

  it('"Werte verwerfen" is an answer', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const c = calls();
    mount(three, c, 'de', { 2: 3 });
    await user.click(within(rowOf(2)).getByRole('button', { name: 'Auf aktuelle Version verschieben' }));
    const dialog = await screen.findByTestId('pin-move');
    await user.selectOptions(await within(dialog).findByRole('combobox'), 'Werte verwerfen');
    await user.click(within(dialog).getByRole('button', { name: 'Verschieben' }));
    expect(c.movePins).toHaveBeenCalledWith(2, { [OPT]: { discard: true } }, 'de');
  });

  it('without any affected value it says so and confirms at once', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const plain = { ...moveView, plan: { ...moveView.plan, groups: [], mappings: [] } };
    const c = calls({ movePlan: vi.fn(async () => ({ ok: true as const, view: plain })) });
    mount(three, c, 'de', { 2: 3 });
    await user.click(within(rowOf(2)).getByRole('button', { name: 'Auf aktuelle Version verschieben' }));
    const dialog = await screen.findByTestId('pin-move');
    expect(await within(dialog).findByText(/Keine Werte sind betroffen/)).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Verschieben' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('a refused move shows the reason and keeps the dialog open', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const c = calls({ movePins: vi.fn(async () => ({ ok: false as const, reason: 'failed' })) });
    mount(three, c, 'de', { 2: 3 });
    await user.click(within(rowOf(2)).getByRole('button', { name: 'Auf aktuelle Version verschieben' }));
    const dialog = await screen.findByTestId('pin-move');
    await user.selectOptions(await within(dialog).findByRole('combobox'), 'Erfasst');
    await user.click(within(dialog).getByRole('button', { name: 'Verschieben' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Das Verschieben hat nicht geklappt. Es wurde nichts geändert.',
    );
  });

  it('a failed dry run shows the reason and cannot be confirmed; Abbrechen closes', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const c = calls({ movePlan: vi.fn(async () => ({ ok: false as const, reason: 'Keine Objekte.' })) });
    mount(three, c, 'de', { 2: 3 });
    await user.click(within(rowOf(2)).getByRole('button', { name: 'Auf aktuelle Version verschieben' }));
    const dialog = await screen.findByTestId('pin-move');
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Keine Objekte.');
    expect((within(dialog).getByRole('button', { name: 'Verschieben' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByTestId('pin-move')).toBeNull());
  });

  it('speaks English', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    mount(three, calls(), 'en', { 2: 3 });
    expect(within(rowOf(2)).getByTestId('pinned-count').textContent).toBe('3 objects still on this version');
    await user.click(within(rowOf(2)).getByRole('button', { name: 'Move to current version' }));
    expect((await screen.findByTestId('pin-move-summary')).textContent).toContain(
      '3 objects switch from version 2 to version 3.',
    );
  });
});
