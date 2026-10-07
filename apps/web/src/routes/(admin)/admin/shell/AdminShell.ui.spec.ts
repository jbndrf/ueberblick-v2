// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import ShellSample from './AdminShell.testing.svelte';

afterEach(cleanup);
const ALPHA = { key: 'alpha', name: 'Alpha Stadt' };
const PROJECTS = [ALPHA, { key: 'zeta', name: 'Zeta Stadt' }];
const base = {
  locale: 'de' as const,
  pathname: '/admin/projects',
  account: { email: 'admin@example.org' },
  projects: PROJECTS,
  currentProject: null,
  theme: 'light' as const,
  onTheme: () => undefined,
  onLocale: () => undefined,
  onSignOut: () => undefined,
};

describe('sidebar (v3 structure)', () => {
  it('the global menu: "Instanz-Einstellungen" below a separator, in a project and out of one (WP-447; v3 :568-586)', () => {
    render(ShellSample, base);
    const link = screen.getByRole('link', { name: 'Instanz-Einstellungen' });
    expect(link.getAttribute('href')).toBe('/admin/instance');
    expect(link.getAttribute('data-active')).toBe('false');
    expect(
      within(screen.getByTestId('global-menu')).getByRole('link', { name: 'Instanz-Einstellungen' }),
    ).toBe(link);
    cleanup();
    render(ShellSample, { ...base, pathname: '/admin/instance' });
    expect(screen.getByRole('link', { name: 'Instanz-Einstellungen' }).getAttribute('data-active')).toBe(
      'true',
    );
    cleanup();
    render(ShellSample, { ...base, pathname: '/admin/projects/alpha/roles', currentProject: ALPHA });
    expect(screen.getByRole('link', { name: 'Instanz-Einstellungen' }).getAttribute('href')).toBe(
      '/admin/instance',
    );
  });

  it('without a project: Projekte (active) and the list "Ihre Projekte"', () => {
    render(ShellSample, base);
    const nav = screen.getByRole('link', { name: 'Projekte' });
    expect(nav.getAttribute('href')).toBe('/admin/projects');
    expect(nav.getAttribute('data-active')).toBe('true');
    expect(screen.getByText('Ihre Projekte')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alpha Stadt' }).getAttribute('href')).toBe(
      '/admin/projects/alpha/settings',
    );
  });

  it('without any project: v3 empty text and a link to create the first one', () => {
    render(ShellSample, { ...base, projects: [] });
    expect(screen.getByText('Noch keine Projekte')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Erstellen Sie Ihr erstes Projekt' }).getAttribute('href')).toBe(
      '/admin/projects',
    );
  });

  it('inside a project: its name, its five pages at v3 URLs, and the Objektarten and Tabellen groups', () => {
    render(ShellSample, {
      ...base,
      pathname: '/admin/projects/alpha/roles',
      currentProject: ALPHA,
    });
    expect(screen.getByText('Alpha Stadt')).toBeTruthy();
    const hrefs = (name: string): string | null => screen.getByRole('link', { name }).getAttribute('href');
    expect(hrefs('Projekteinstellungen')).toBe('/admin/projects/alpha/settings');
    expect(hrefs('Teilnehmende')).toBe('/admin/projects/alpha/participants');
    expect(hrefs('Rollen')).toBe('/admin/projects/alpha/roles');
    expect(hrefs('Beziehungen')).toBe('/admin/projects/alpha/relations');
    expect(hrefs('Versionen')).toBe('/admin/projects/alpha/versions');
    expect(screen.getByRole('link', { name: 'Rollen' }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('link', { name: 'Teilnehmende' }).getAttribute('data-active')).toBe('false');
    expect(screen.getByRole('button', { name: 'Objektarten' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tabellen' })).toBeTruthy();
    expect(screen.getByText('Noch keine Objektarten')).toBeTruthy();
    // v3's draft badge and fork link are obsolete (one project with a draft, Veröffentlichen)
    expect(screen.queryByText(/Entwurf/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Releases|Fork/ })).toBeNull();
  });

  it('a group folds and unfolds', async () => {
    render(ShellSample, { ...base, pathname: '/admin/projects/alpha/roles', currentProject: ALPHA });
    await userEvent.click(screen.getByRole('button', { name: 'Objektarten' }));
    expect(screen.queryByText('Noch keine Objektarten')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Objektarten' }));
    expect(screen.getByText('Noch keine Objektarten')).toBeTruthy();
  });

  it('is in English for en (Versionen is Versions)', () => {
    render(ShellSample, {
      ...base,
      locale: 'en',
      pathname: '/admin/projects/alpha/roles',
      currentProject: ALPHA,
    });
    expect(screen.getByRole('link', { name: 'Versions' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Participants' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Project settings' })).toBeTruthy();
  });
});

describe('header and account menu', () => {
  it('the header is 40 px (h-10) with the sidebar trigger', () => {
    const { baseElement } = render(ShellSample, base);
    expect(baseElement.querySelector('header')?.getAttribute('class')).toContain('h-10');
    expect(screen.getByRole('button', { name: 'Seitenleiste umschalten' })).toBeTruthy();
  });

  it('shows the e-mail, switches theme and language and signs out', async () => {
    const onTheme = vi.fn();
    const onLocale = vi.fn();
    const onSignOut = vi.fn();
    render(ShellSample, { ...base, onTheme, onLocale, onSignOut });
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    await user.click(screen.getByRole('button', { name: 'Konto' }));
    expect(screen.getByText('admin@example.org')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Einstellungen' })).toBeNull();

    await user.hover(screen.getByText('Design'));
    await user.click(await screen.findByText('Dunkel'));
    expect(onTheme).toHaveBeenCalledWith('dark');

    await user.click(screen.getByRole('button', { name: 'Konto' }));
    await user.hover(screen.getByText('Sprache'));
    await user.click(await screen.findByText('English'));
    expect(onLocale).toHaveBeenCalledWith('en');

    await user.click(screen.getByRole('button', { name: 'Konto' }));
    await user.click(screen.getByText('Abmelden'));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('renders the page content in the inset', () => {
    render(ShellSample, base);
    expect(within(screen.getByRole('main')).getByText('Inhalt')).toBeTruthy();
  });
});
