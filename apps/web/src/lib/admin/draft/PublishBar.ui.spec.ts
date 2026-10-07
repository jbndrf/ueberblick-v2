// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import PublishBar from './PublishBar.svelte';
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
import type { DraftStatusView } from './publish-client';
import { deployOverview } from '../deploy/overview-store.svelte';

afterEach(() => {
  cleanup();
  deployOverview.open = false;
  deployOverview.published = null;
  document.body.style.pointerEvents = ''; // a closed dialog may leave its scroll lock behind
});
const DIRTY: DraftStatusView = { dirty: true, neverPublished: false, problems: 0, revision: 3, type: 'baum' };
const NEVER: DraftStatusView = { dirty: true, neverPublished: true, problems: 0, revision: 1, type: 'baum' };
const CLEAN: DraftStatusView = {
  dirty: false,
  neverPublished: false,
  problems: 0,
  revision: 3,
  type: 'baum',
};

function mount(status: DraftStatusView | null, locale: Locale = 'de') {
  render(PublishBar, { locale, project: 'muster', status });
}

describe('publish bar (v3 status look, Q13/Q16/Q17)', () => {
  it('shows nothing while the draft equals the deployed version', () => {
    mount(CLEAN);
    expect(screen.queryByRole('button', { name: 'Veröffentlichen' })).toBeNull();
    expect(screen.queryByTestId('publish-bar')).toBeNull();
  });

  it('shows nothing while the status is unknown', () => {
    mount(null);
    expect(screen.queryByTestId('publish-bar')).toBeNull();
  });

  it('a never-published project says "Nicht veröffentlicht"', () => {
    mount(NEVER);
    expect(screen.getByTestId('publish-bar').textContent).toContain('Nicht veröffentlicht');
    expect(screen.getByText(/Bis zur ersten Veröffentlichung sehen Teilnehmende nichts/)).toBeTruthy();
  });

  it('changes say "Unveröffentlichte Änderungen"', () => {
    mount(DIRTY);
    expect(screen.getByTestId('publish-bar').textContent).toContain('Unveröffentlichte Änderungen');
  });

  it('Veröffentlichen opens the deploy overview (no simple confirm any more, WP-360)', async () => {
    mount(DIRTY);
    expect(deployOverview.open).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));
    expect(deployOverview.open).toBe(true);
  });

  it('after a deploy the bar tells the version, and the line goes away by itself', async () => {
    vi.useFakeTimers();
    try {
      mount(CLEAN);
      deployOverview.published = 2;
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByRole('status').textContent).toContain('Version 2 ist live.');
      await vi.advanceTimersByTimeAsync(6100);
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocking problems show as a count linking to the builder; the overview holds the confirm', async () => {
    mount({ ...DIRTY, problems: 2 });
    expect(screen.getByText('2 Probleme verhindern das Veröffentlichen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Im Builder öffnen' }).getAttribute('href')).toBe(
      '/admin/projects/muster/types/baum/builder',
    );
    expect((screen.getByRole('button', { name: 'Veröffentlichen' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('a single problem uses the singular', () => {
    mount({ ...DIRTY, problems: 1 });
    expect(screen.getByText('1 Problem verhindert das Veröffentlichen.')).toBeTruthy();
  });

  it('English labels', () => {
    mount(NEVER, 'en');
    expect(screen.getByTestId('publish-bar').textContent).toContain('Not published');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
  });
});
