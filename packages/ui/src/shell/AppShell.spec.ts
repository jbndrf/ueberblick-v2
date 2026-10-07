// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import type { TemplateFile } from '@ueberblick/core/model';
import AppShell from './testing/Harness.svelte';
import { deriveShellModel } from './model';
import type { AppShellProps, StatusModel } from './contract';
import { axeViolations } from '../testing/axe';

const file = {
  schema: '1',
  template: { key: 't', version: '1.0.0' },
  roles: {
    worker: {
      label: 'Worker',
      app: {
        home: 'mein',
        views: { mein: {}, alle: {} },
        tools: { photo: {} },
        shortcuts: { kontrolle: {} },
        ui: { theme: 'outdoor' },
      },
    },
    empty: { label: 'Empty', app: { views: {} } },
  },
  views: { alle: { label: 'All trees' }, mein: { label: 'Mine' } },
  tools: { photo: {}, gps: {} },
  tasks: {
    kontrolle: { label: 'Inspection', on: { create: 'baum' } },
    melden: { label: 'Report', on: { create: 'schaden' } },
  },
} as unknown as TemplateFile;

const okStatus: StatusModel = {
  online: true,
  lastSyncedAt: '2026-09-29T08:00:00Z',
  pending: 0,
  oldestPendingAge: null,
  refused: [],
  storage: 'ok',
};

function props(
  over: Partial<AppShellProps> & { withAssistant?: boolean; withFeature?: boolean } = {},
  roleKey = 'worker',
): Record<string, unknown> {
  return {
    model: deriveShellModel({ file, roleKey, locale: 'en' }),
    status: okStatus,
    onexport: () => {},
    ...over,
  };
}

describe('AppShell structure', () => {
  it('has landmarks and a skip link that moves focus to main', async () => {
    render(AppShell, props());
    screen.getByRole('banner');
    screen.getByRole('navigation', { name: 'Main navigation' });
    const main = screen.getByRole('main');
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(skip);
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(main);
  });

  it('shows the map for the role home view and switches views', async () => {
    render(AppShell, props());
    const main = screen.getByRole('main');
    expect(within(main).getByText('map:mein')).toBeTruthy();
    const views = screen.getByRole('group', { name: 'Views' });
    expect(within(views).getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.setup().click(within(views).getByRole('button', { name: 'All trees' }));
    expect(within(main).getByText('map:alle')).toBeTruthy();
  });

  it('shows only the role tools and no assistant panel by default (H4)', () => {
    const { container } = render(AppShell, props());
    const tools = screen.getByRole('group', { name: 'Tools' });
    expect(within(tools).getAllByRole('button')).toHaveLength(1);
    expect(container.querySelector('[data-slot="assistant"]')).toBeNull();
  });

  it('renders the assistant slot only when given', () => {
    const { container } = render(AppShell, props({ withAssistant: true }));
    expect(container.querySelector('[data-slot="assistant"]')?.textContent).toContain('hi assistant');
  });

  it('a role without views gets an honest empty state', () => {
    render(AppShell, props({}, 'empty'));
    expect(screen.getByText('No view is available for your role.')).toBeTruthy();
  });

  it('switches to Me and shows its sections (level 2)', async () => {
    render(AppShell, props());
    const user = userEvent.setup();
    await user.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Me' }));
    expect(within(screen.getByRole('main')).getByText('me:profile')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Offline packs' }));
    expect(within(screen.getByRole('main')).getByText('me:offline_packs')).toBeTruthy();
  });

  it('applies the theme of the model', () => {
    const { container } = render(AppShell, props());
    expect(container.querySelector('.ub-shell')?.getAttribute('data-theme')).toBe('outdoor');
  });

  it('has no axe violations', async () => {
    const { container } = render(AppShell, props());
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('AppShell tasks', () => {
  it('a shortcut opens its task sheet in one tap', async () => {
    const ontask = vi.fn();
    render(AppShell, props({ ontask }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Inspection' }));
    expect(ontask).toHaveBeenCalledWith('kontrolle');
    expect(within(screen.getByRole('dialog')).getByText('task:kontrolle')).toBeTruthy();
  });

  it('"+" lists the tasks; choosing one opens the task sheet', async () => {
    render(AppShell, props());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'New task' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Choose a task' })).getByRole('button', { name: 'Report' }),
    );
    expect(within(screen.getByRole('dialog')).getByText('task:melden')).toBeTruthy();
  });

  it('opens the feature sheet for featureId', () => {
    render(AppShell, props({ featureId: 'f1', withFeature: true }));
    expect(within(screen.getByRole('dialog')).getByText('feat:f1')).toBeTruthy();
  });
});

describe('status indicator', () => {
  it('is visible in every area and shows the online state', async () => {
    render(AppShell, props());
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('button', { name: /Status/ })).toBeTruthy();
    await userEvent.setup().click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Me' }));
    expect(within(screen.getByRole('banner')).getByRole('button', { name: /Status/ })).toBeTruthy();
  });

  it('with pending runs shows the count as text and an icon', () => {
    render(AppShell, props({ status: { ...okStatus, pending: 3, oldestPendingAge: 120000 } }));
    const btn = within(screen.getByRole('banner')).getByRole('button', { name: /Status/ });
    expect(btn.textContent).toContain('3 unsent');
    expect(btn.querySelector('svg')).not.toBeNull();
  });

  it('with storage at risk shows "Data at risk" and offers the queue export in the details', async () => {
    const onexport = vi.fn();
    render(
      AppShell,
      props({ status: { ...okStatus, pending: 2, oldestPendingAge: 60000, storage: 'at_risk' }, onexport }),
    );
    const btn = within(screen.getByRole('banner')).getByRole('button', { name: /Status/ });
    expect(btn.textContent).toContain('Data at risk');
    const user = userEvent.setup();
    await user.click(btn);
    const dialog = screen.getByRole('dialog', { name: 'Status details' });
    await user.click(within(dialog).getByRole('button', { name: 'Export unsent runs' }));
    expect(onexport).toHaveBeenCalledOnce();
  });

  it('details list refused runs with their reasons, pending age and last sync', async () => {
    render(
      AppShell,
      props({
        status: {
          ...okStatus,
          pending: 1,
          oldestPendingAge: 5 * 60000,
          refused: [{ runId: 'run-9', reason: 'Not permitted' }],
        },
      }),
    );
    const user = userEvent.setup();
    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: /Status/ }));
    const dialog = screen.getByRole('dialog', { name: 'Status details' });
    expect(dialog.textContent).toContain('run-9');
    expect(dialog.textContent).toContain('Not permitted');
    expect(dialog.textContent).toContain('5 min');
    expect(dialog.textContent).toContain('Last synced');
  });

  it('never synced is stated honestly, and offline is shown', async () => {
    render(AppShell, props({ status: { ...okStatus, online: false, lastSyncedAt: null } }));
    const user = userEvent.setup();
    const btn = within(screen.getByRole('banner')).getByRole('button', { name: /Status/ });
    expect(btn.textContent).toContain('Offline');
    await user.click(btn);
    expect(screen.getByRole('dialog').textContent).toContain('Never synced');
  });

  it('has no axe violations with everything to show', async () => {
    const { container } = render(
      AppShell,
      props({
        status: {
          ...okStatus,
          pending: 2,
          oldestPendingAge: 1000,
          storage: 'at_risk',
          refused: [{ runId: 'r', reason: 'x' }],
        },
      }),
    );
    await userEvent.setup().click(within(screen.getByRole('banner')).getByRole('button', { name: /Status/ }));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('targets are at least 56 px for primary and 44 px for others', () => {
    render(AppShell, props());
    const nav = within(screen.getByRole('navigation')).getAllByRole('button');
    for (const b of nav) expect(parseFloat(getComputedStyle(b).minHeight)).toBeGreaterThanOrEqual(56);
    const status = within(screen.getByRole('banner')).getByRole('button', { name: /Status/ });
    expect(parseFloat(getComputedStyle(status).minHeight)).toBeGreaterThanOrEqual(44);
  });
});
