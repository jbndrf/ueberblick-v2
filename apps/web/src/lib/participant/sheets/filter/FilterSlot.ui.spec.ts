// @vitest-environment jsdom
// The Ansichten tool in the filter slot (WP-665): the tab exists only while the tool is on, a new view becomes the
// active one and shows the builder, edits are saved in the person's preference record (offline too, and on a
// second device after a sync), and the active view is kept and restored.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import {
  createPrefsClient,
  type KeyValueStorage,
  type PrefsClient,
  type PrefsTransport,
} from '@ueberblick/client';
import { mergePrefs, type PrefEntry, type PrefStore } from '@ueberblick/core';
import type { FeatureState, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import '@ueberblick/ui/testing';
import type { Device } from '../../device';
import FilterSlot from '../../shell/FilterSlot.svelte';
import type { ShellContext } from '../../shell/sheets';
import { toolEntries } from '../../tools/entries';
import { createFilterController } from './filter-controller';
import { bindViews } from './filter-active';

const base = goldenConfig('templates/baumkataster/1.0.0.yaml');
// The role offers the tool (availability "offered"): the person switches it on in Einstellungen.
const roles = base.file.roles ?? {};
const config = {
  ...base,
  file: {
    ...base.file,
    tools: { ...base.file.tools, views: {} },
    roles: {
      ...roles,
      kontrolle: {
        ...roles['kontrolle'],
        app: {
          ...roles['kontrolle']?.app,
          tools: { measure: {}, search: {}, views: { availability: 'offered' } },
        },
      },
    },
  },
};
const actor = { id: 'u1', kind: 'participant' as const, roles: ['kontrolle' as Key] };
const tree = (id: string, by: string): FeatureState =>
  ({
    id,
    type: 'baum',
    properties: {},
    lifecycle: 'active',
    updatedSeq: 1,
    createdBy: by,
  }) as unknown as FeatureState;
const trees = [tree('1', 'u1'), tree('2', 'u2')];

const device = {
  project: 'baeume',
  get classified() {
    return (this as { config: never }).config;
  },
  config,
  actor,
  roleKey: 'kontrolle',
  participant: { id: 'u1', name: 'Berta' },
  changed: { subscribe: () => () => undefined },
  viewList: () => ({ rows: () => [], rowsOf: () => [], rename: (rows: readonly unknown[]) => rows }),
  feature: (id: string) => trees.find((t) => t.id === id),
  store: {
    featureIdsOfType: (t: string) => (t === 'baum' ? trees.map((x) => x.id) : []),
    personName: () => undefined,
  },
} as unknown as Device;

function server() {
  let record: PrefStore = {};
  const s = {
    offline: false,
    transport: {
      fetch: async () => {
        if (s.offline) throw new Error('offline');
        return { entries: record };
      },
      send: async (entries: readonly PrefEntry[]) => {
        if (s.offline) throw new Error('offline');
        record = mergePrefs(record, entries);
        return { entries: record };
      },
    } satisfies PrefsTransport,
  };
  return s;
}
const storage = (): KeyValueStorage => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
};
let clock = 0;
const client = (s: ReturnType<typeof server>, st = storage()): PrefsClient =>
  createPrefsClient({
    storage: st,
    transport: s.transport,
    clock: {
      now: () =>
        `2026-10-01T08:${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock++ % 60).padStart(2, '0')}.000Z`,
    },
    project: 'baeume',
    participant: 'u1',
  });

function slot(record: PrefsClient, on: boolean) {
  const filter = createFilterController();
  const switches = on ? { views: true } : { views: false };
  const entries = toolEntries(config.file as never, 'kontrolle', switches);
  const ctx = {
    device,
    locale: 'de',
    viewKey: null,
    filter,
    record,
    manageTabs: () => undefined,
    tools: { entries, person: {} },
  } as unknown as ShellContext;
  render(FilterSlot, { ctx, onclose: () => undefined });
  return { filter };
}

afterEach(() => cleanup());

describe('the Ansichten tool (v3 filter.field_filters)', () => {
  it('is hidden unless switched on: no Ansichten tab, only the Einfach content', () => {
    slot(client(server()), false);
    expect(screen.queryByRole('tab', { name: 'Ansichten' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('switched on: the Ansichten tab shows', () => {
    slot(client(server()), true);
    expect(screen.getByRole('tab', { name: 'Ansichten' })).toBeTruthy();
  });

  it('a new view is saved empty, becomes the active one and opens the builder under it', async () => {
    const record = client(server());
    const { filter } = slot(record, true);
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Neue Ansicht' }));
    await fireEvent.input(screen.getByPlaceholderText('Ansicht benennen…'), {
      target: { value: 'Alte Bäume' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const saved = record.current().filters.saved;
    expect(saved.map((s) => [s.name, s.filters])).toEqual([['Alte Bäume', {}]]);
    expect(filter.activeView()).toEqual({ kind: 'saved', key: saved[0]?.id });
    expect(await screen.findByText('Felder filtern')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Weitere Bedingung hinzufügen' })).toBeTruthy();
  });

  it('an edit in the builder is saved on the view, offline, and follows the person to a second device', async () => {
    const s = server();
    const phone = client(s);
    slot(phone, true);
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Neue Ansicht' }));
    await fireEvent.input(screen.getByPlaceholderText('Ansicht benennen…'), { target: { value: 'Neu' } });
    s.offline = true; // no network from here on
    await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Weitere Bedingung hinzufügen' }));
    await user.click(screen.getByRole('menuitem', { name: 'Änderungsdatum' }));
    await fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } });
    const view = phone.current().filters.saved[0];
    expect(view?.filters['baum']).toBe('(self.$changed_at < now - days(3))');
    expect(view?.filters['flaeche']).toBe('(self.$changed_at < now - days(3))');
    expect(await phone.sync()).toBe(false); // offline: kept on the device
    s.offline = false;
    expect(await phone.sync()).toBe(true);
    const tablet = client(s);
    await tablet.sync();
    expect(tablet.current().filters.saved).toEqual(phone.current().filters.saved);
  });

  it('renaming keeps the view and its rows, offline', async () => {
    const s = server();
    s.offline = true;
    const record = client(s);
    record.set('filters.saved', [
      { id: 'v1', name: 'Eins', filters: { baum: '(self.befund.contains("x"))' } },
    ]);
    slot(record, true);
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Umbenennen' }));
    const input = screen.getByRole('textbox', { name: 'Umbenennen' });
    await fireEvent.input(input, { target: { value: 'Zwei' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(record.current().filters.saved).toEqual([
      { id: 'v1', name: 'Zwei', filters: { baum: '(self.befund.contains("x"))' } },
    ]);
  });

  it('deleting the active view ends it', async () => {
    const record = client(server());
    record.set('filters.saved', [{ id: 'v1', name: 'Eins', filters: {} }]);
    const { filter } = slot(record, true);
    filter.setActiveView({ kind: 'saved', key: 'v1' });
    await fireEvent.click(screen.getByRole('tab', { name: 'Ansichten' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(record.current().filters.saved).toEqual([]);
    await waitFor(() => expect(filter.activeView()).toBeNull());
  });
});

describe('the active view is kept with the person (v3 filter.active_view)', () => {
  const file = config.file as never;
  it('is written to filters.active, restored at the next start and on another device', async () => {
    const s = server();
    const phone = client(s);
    phone.set('filters.saved', [{ id: 'v1', name: 'Eins', filters: {} }]);
    const f1 = createFilterController();
    const stop = bindViews({ filter: f1, record: phone, file, roleKey: 'kontrolle' });
    f1.setActiveView({ kind: 'saved', key: 'v1' });
    expect(phone.current().filters.active).toBe('v1');
    stop();
    await phone.sync();
    const tablet = client(s);
    await tablet.sync();
    const f2 = createFilterController();
    bindViews({ filter: f2, record: tablet, file, roleKey: 'kontrolle' });
    expect(f2.activeView()).toEqual({ kind: 'saved', key: 'v1' });
    f2.setActiveView(null);
    expect(tablet.current().filters.active).toBeNull();
  });

  it('forgets a view that is gone, and keeps a role preset as preset:<key>', () => {
    const record = client(server());
    record.set('filters.active', 'weg');
    const f = createFilterController();
    bindViews({ filter: f, record, file, roleKey: 'kontrolle' });
    expect(f.activeView()).toBeNull();
    f.setActiveView({ kind: 'preset', key: 'meine' });
    expect(record.current().filters.active).toBe('preset:meine');
  });

  it('the map evaluates the view again when its source or the tool switch changes under it', () => {
    const record = client(server());
    record.set('filters.saved', [{ id: 'v1', name: 'Eins', filters: {} }]);
    const f = createFilterController();
    bindViews({ filter: f, record, file, roleKey: 'kontrolle' });
    const before = f.viewRevision();
    record.set('filters.saved', [{ id: 'v1', name: 'Eins', filters: { baum: 'self.befund == "x"' } }]);
    expect(f.viewRevision()).toBe(before + 1);
    record.set('tools.views', true); // the role offers the tool: switched on, the view applies
    expect(f.viewRevision()).toBe(before + 2);
    record.set('tools.views', false); // switched off: the map drops the view
    expect(f.viewRevision()).toBe(before + 3);
    record.set('ui.theme', 'dark'); // anything else in the record leaves the map alone
    expect(f.viewRevision()).toBe(before + 3);
  });
});
