// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import { draftStatus, notifyDraftChanged } from '../../../../lib/admin/draft/status-store.svelte';
import type { DraftStatusView } from '../../../../lib/admin/draft/publish-client';
import ShellSample from './AdminShell.testing.svelte';

afterEach(() => {
  cleanup();
  draftStatus.clear();
  document.body.style.pointerEvents = '';
});

const PROJECT = { key: 'alpha', name: 'Alpha Stadt' };
const base = {
  locale: 'de' as const,
  pathname: '/admin/projects/alpha/roles',
  account: { email: 'admin@example.org' },
  projects: [PROJECT],
  currentProject: PROJECT,
  theme: 'light' as const,
  onTheme: () => undefined,
  onLocale: () => undefined,
  onSignOut: () => undefined,
};
const NEVER: DraftStatusView = { dirty: true, neverPublished: true, problems: 0, revision: 1, type: 'baum' };
const DIRTY: DraftStatusView = { dirty: true, neverPublished: false, problems: 0, revision: 2, type: 'baum' };
const CLEAN: DraftStatusView = {
  dirty: false,
  neverPublished: false,
  problems: 0,
  revision: 2,
  type: 'baum',
};

const reply = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A server stand-in: `state.status` is what the status route answers; a deploy makes it clean. */
function server(state: { status: DraftStatusView }) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/draft/status')) return reply(state.status);
    if (url.includes('/plan'))
      return reply({
        revision: state.status.revision,
        first: state.status.neverPublished,
        warnings: [],
        groups: [{ type: 'baum', label: 'Baum', isNew: false, isRemoved: false, objects: 0, entries: [] }],
        versions: [],
        mappings: [],
        blockers: [],
      });
    state.status = CLEAN;
    return reply({ ok: true, version: 1, created: true, warnings: [] });
  }) as unknown as typeof fetch;
}

describe('the admin shell shows the draft state (WP-326)', () => {
  it('a never-published project: bar "Nicht veröffentlicht" and the sidebar badge', async () => {
    render(ShellSample, { ...base, draftFetch: server({ status: NEVER }) });
    expect(await screen.findByTestId('publish-bar')).toBeTruthy();
    expect(screen.getByTestId('publish-bar').textContent).toContain('Nicht veröffentlicht');
    expect(screen.getByTestId('draft-badge').textContent).toContain('Nicht veröffentlicht');
    expect(screen.getByTestId('draft-badge').getAttribute('href')).toBe('/admin/projects/alpha/versions');
  });

  it('a clean draft shows neither bar nor badge', async () => {
    const f = server({ status: CLEAN });
    render(ShellSample, { ...base, draftFetch: f });
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.queryByTestId('publish-bar')).toBeNull();
    expect(screen.queryByTestId('draft-badge')).toBeNull();
  });

  it('outside a project there is no draft and no request', () => {
    const f = server({ status: DIRTY });
    render(ShellSample, { ...base, currentProject: null, pathname: '/admin/projects', draftFetch: f });
    expect(f).not.toHaveBeenCalled();
    expect(screen.queryByTestId('publish-bar')).toBeNull();
  });

  it('Veröffentlichen opens the deploy overview, confirming deploys: the bar and the badge clear', async () => {
    const f = server({ status: DIRTY });
    render(ShellSample, { ...base, draftFetch: f });
    await userEvent.click(await screen.findByRole('button', { name: 'Veröffentlichen' }));
    const overview = await screen.findByTestId('deploy-overview');
    await screen.findByTestId('deploy-group');
    await userEvent.click(within(overview).getByRole('button', { name: 'Veröffentlichen' }));
    await waitFor(() => expect(screen.queryByTestId('publish-bar')).toBeNull());
    expect(screen.queryByTestId('draft-badge')).toBeNull();
    expect(screen.getAllByRole('status').some((e) => e.textContent?.includes('Version 1 ist live.'))).toBe(
      true,
    );
    expect(f).toHaveBeenCalledWith(
      '/builder-api/alpha/deploy',
      expect.objectContaining({ body: JSON.stringify({ revision: 2, mappings: {}, versions: {} }) }),
    );
  });

  it('a page that saved the draft calls notifyDraftChanged and the bar follows', async () => {
    const state = { status: CLEAN };
    render(ShellSample, { ...base, draftFetch: server(state) });
    await waitFor(() => expect(draftStatus.project).toBe('alpha'));
    expect(screen.queryByTestId('publish-bar')).toBeNull();
    state.status = DIRTY;
    notifyDraftChanged();
    expect(await screen.findByTestId('publish-bar')).toBeTruthy();
    expect(screen.getByTestId('draft-badge').textContent).toContain('Unveröffentlichte Änderungen');
  });

  it("a failed status read keeps what is shown, and never shows another project's state", async () => {
    const f = vi.fn(async () => reply({}, 500)) as unknown as typeof fetch;
    draftStatus.status = DIRTY;
    draftStatus.project = 'zeta';
    render(ShellSample, { ...base, draftFetch: f });
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.queryByTestId('publish-bar')).toBeNull();
  });
});
