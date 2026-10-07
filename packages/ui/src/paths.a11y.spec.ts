// @vitest-environment jsdom
// WP-554: keyboard-only and screen-reader smoke paths through the shell, the list alternative to the map,
// and the task sheet. The screen-reader half asserts what assistive technology
// reads: landmarks, roles, accessible names, live regions, sort state. The browser run is e2e/a11y.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { FeatureId, Key, Property, TemplateFile } from '@ueberblick/core/model';
import './components/ui/jsdom-shims.testing';
import AppShell from './shell/testing/Harness.svelte';
import { deriveShellModel } from './shell/model';
import FeatureList from './map/FeatureList.svelte';
import { pointFeature } from './map/test-helpers';
import TaskSheetHarness from './task-sheet/testing/Harness.svelte';
import { fakeIds, fakeSubmitter, memoryDrafts } from './task-sheet/testing/ports';
import { buildFormModel } from './form/model';
import { evalContext, formWorld } from './form/form.testing';
import type { StatusModel } from './shell/contract';

afterEach(cleanup);

const file = {
  schema: '1',
  template: { key: 't', version: '1.0.0' },
  roles: {
    worker: {
      label: 'Worker',
      app: { home: 'mein', views: { mein: {}, alle: {} }, shortcuts: { kontrolle: {} } },
    },
  },
  views: { alle: { label: 'All trees' }, mein: { label: 'Mine' } },
  tasks: { kontrolle: { label: 'Inspection', on: { create: 'baum' } } },
} as unknown as TemplateFile;
const status: StatusModel = {
  online: true,
  lastSyncedAt: '2026-09-29T08:00:00Z',
  pending: 0,
  oldestPendingAge: null,
  refused: [],
  storage: 'ok',
};

describe('shell: keyboard only', () => {
  const shell = () =>
    render(AppShell, {
      model: deriveShellModel({ file, roleKey: 'worker', locale: 'en' }),
      status,
      onexport: () => {},
    });

  it('skip link, view chips, shortcut and area switch are reachable with Tab, Enter and Space', async () => {
    shell();
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to content' }));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('main'));

    const views = screen.getByRole('group', { name: 'Views' });
    within(views).getByRole('button', { name: 'All trees' }).focus();
    await user.keyboard(' ');
    expect(within(views).getByRole('button', { name: 'All trees' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    screen.getByRole('button', { name: 'Inspection' }).focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Inspection' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    within(nav).getByRole('button', { name: /^Me/ }).focus();
    await user.keyboard('{Enter}');
    expect(within(nav).getByRole('button', { name: /^Me/ }).getAttribute('aria-current')).toBe('page');
  });

  it('screen reader: banner, main, navigation landmarks; every control has a name; state is exposed', () => {
    shell();
    screen.getByRole('banner');
    screen.getByRole('main');
    screen.getByRole('navigation', { name: 'Main navigation' });
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-label') ?? b.textContent?.trim(), b.outerHTML).toBeTruthy();
    }
    expect(screen.getByRole('status')).toBeTruthy(); // connection state is a live region
    const mine = screen.getByRole('button', { name: 'Mine' });
    expect(mine.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('list alternative to the map', () => {
  const props = {
    features: [
      { ...pointFeature('a', 8, 50, { height: 12 }), name: 'Oak' },
      { ...pointFeature('b', 9, 51, { height: 30 }), name: 'Ash' },
    ],
    columns: [{ key: 'height', label: 'Height' }],
    labels: {
      caption: 'Trees in view',
      empty: 'Nothing here',
      sortedAscending: 'ascending',
      sortedDescending: 'descending',
      name: 'Name',
    },
  };

  it('keyboard: Tab to a column sorts with Enter; Tab to a row opens the feature with Enter', async () => {
    const tap = vi.fn();
    render(FeatureList, { ...props, onFeatureTap: tap });
    const user = userEvent.setup();
    await user.tab(); // the scroll region (WP-855)
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Name/ }));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe('ascending');
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(tap).toHaveBeenCalledWith('b'); // Ash sorts first
  });

  it('screen reader: a table with a caption, column headers and a sort state', () => {
    render(FeatureList, { ...props, onFeatureTap: () => {} });
    const table = screen.getByRole('table', { name: 'Trees in view' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });
});

describe('task sheet', () => {
  const P = (type: string, extra: Record<string, unknown> = {}) =>
    ({ type, ...extra }) as unknown as Property;
  const def = {
    form: { vitalitaet: { required: true } },
    properties: { vitalitaet: P('integer', { label: 'Vitality' }) },
  };
  const setup = () => {
    const { config } = formWorld(def, 'kontrolle' as Key);
    const submitter = fakeSubmitter(0);
    render(TaskSheetHarness, {
      taskKey: 'kontrolle' as Key,
      model: buildFormModel(def),
      config,
      ctx: evalContext(config),
      ids: fakeIds(),
      submitter,
      drafts: memoryDrafts(),
      online: false,
      featureIds: ['f1' as FeatureId],
    });
    return { submitter, user: userEvent.setup() };
  };

  it('keyboard: type the value and submit with Enter; the outcome is announced as status', async () => {
    const { submitter, user } = setup();
    await user.type(await screen.findByLabelText(/Vitality/), '2{Enter}');
    await waitFor(() => expect(submitter.submitted).toHaveLength(1));
    expect((await screen.findByRole('status')).textContent).toBeTruthy();
  });

  it('screen reader: an empty required field is reported by an alert whose links name the field', async () => {
    const { user } = setup();
    await screen.findByLabelText(/Vitality/);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: /Vitality/ })).toBeTruthy();
    expect(screen.getByLabelText(/Vitality/).getAttribute('aria-invalid')).toBe('true');
  });
});
