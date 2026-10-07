// @vitest-environment jsdom
// WP-418 (S3-19): the data page header edits in place: name and description (Escape cancels, an empty name is refused
// inline), "Sichtbar für Rollen", the type and geometry pills and "Private Einträge". The component sends calls; the
// route writes the draft (`header-ops.spec.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import DataHeader from './DataHeader.svelte';
import type { HeaderCall, HeaderResult, HeaderState } from './header-types';

// The open dropdown sets `pointer-events: none` on the body; a repeat in the same process must start clean.
afterEach(() => {
  cleanup();
  document.body.removeAttribute('style');
});

const state = (over: Partial<HeaderState> = {}): HeaderState => ({
  description: 'Alle Bäume',
  roles: [
    { key: 'verwaltung', label: 'Verwaltung' },
    { key: 'kontrolle', label: 'Kontrolle' },
  ],
  audience: { kind: 'roles', roles: ['verwaltung'] },
  private: 'off',
  shape: { map: true, kind: 'point' },
  featureCount: 0,
  ...over,
});

function mount(
  header: HeaderState | undefined,
  onCall = vi.fn(async (): Promise<HeaderResult> => ({ ok: true })),
) {
  render(DataHeader, {
    name: 'Baum',
    description: header?.description ?? '',
    builderHref: '/b',
    builderLabel: 'Builder',
    refreshLabel: 'Aktualisieren',
    onRefresh: vi.fn(),
    importLabel: 'CSV importieren',
    onImport: vi.fn(),
    header,
    locale: 'de',
    onCall: header ? onCall : undefined,
  });
  return onCall as unknown as ReturnType<typeof vi.fn<(c: HeaderCall) => Promise<HeaderResult>>>;
}

describe('name and description', () => {
  it('a click opens the name field; Enter saves it as one call', async () => {
    const onCall = mount(state());
    await userEvent.click(screen.getByTestId('data-name'));
    const input = screen.getByTestId('data-name-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'Straßenbaum{Enter}');
    expect(onCall).toHaveBeenCalledWith({ action: 'name', value: 'Straßenbaum' });
    await waitFor(() => expect(screen.queryByTestId('data-name-input')).toBeNull());
  });
  it('Escape cancels without a call', async () => {
    const onCall = mount(state());
    await userEvent.click(screen.getByTestId('data-name'));
    await userEvent.type(screen.getByTestId('data-name-input'), 'X{Escape}');
    expect(screen.queryByTestId('data-name-input')).toBeNull();
    expect(onCall).not.toHaveBeenCalled();
  });
  it('refuses an empty name inline and keeps the field open', async () => {
    const onCall = mount(state());
    await userEvent.click(screen.getByTestId('data-name'));
    await userEvent.clear(screen.getByTestId('data-name-input'));
    await userEvent.keyboard('{Enter}');
    expect((await screen.findByTestId('data-name-error')).textContent).toContain('nicht leer');
    expect(screen.getByTestId('data-name-input')).toBeTruthy();
    expect(onCall).not.toHaveBeenCalled();
  });
  it("shows the server's refusal under the name", async () => {
    const onCall = vi.fn(async (): Promise<HeaderResult> => ({ ok: false, message: 'Abgelehnt' }));
    mount(state(), onCall);
    await userEvent.click(screen.getByTestId('data-name'));
    await userEvent.type(screen.getByTestId('data-name-input'), 'x{Enter}');
    expect((await screen.findByTestId('data-name-error')).textContent).toBe('Abgelehnt');
  });
  it('saves the description on Enter', async () => {
    const onCall = mount(state());
    await userEvent.click(screen.getByTestId('data-description'));
    const input = screen.getByTestId('data-description-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'Neu{Enter}');
    expect(onCall).toHaveBeenCalledWith({ action: 'description', value: 'Neu' });
  });
});

describe('"Sichtbar für Rollen"', () => {
  it('shows the roles as chips and says Alle for every role', () => {
    mount(state());
    expect(screen.getByTestId('data-roles').textContent).toContain('Verwaltung');
  });
  it('a per-property audience is read-only with a pointer to the builder', () => {
    mount(state({ audience: { kind: 'property' } }));
    expect(screen.getByTestId('data-roles-property').textContent).toContain('Pro Eigenschaft');
    expect(screen.queryByTestId('data-roles')).toBeNull();
  });
});

describe('"Private Einträge"', () => {
  it('on: the switch sends the call', async () => {
    const onCall = mount(state());
    await userEvent.click(screen.getByTestId('data-private'));
    expect(onCall).toHaveBeenCalledWith({ action: 'private', on: true });
  });
  it('is on when the draft says so', () => {
    mount(state({ private: 'on' }));
    expect(screen.getByTestId('data-private').getAttribute('aria-checked')).toBe('true');
  });
  it('custom: the switch is locked and the condition is shown', () => {
    mount(state({ private: 'custom', privateWhen: 'self.x == 1' }));
    expect((screen.getByTestId('data-private') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('data-private-custom').textContent).toContain('self.x == 1');
  });
});

describe('shape pills', () => {
  it('shows the type and the geometry pill of a map type', () => {
    mount(state());
    expect(screen.getByTestId('data-type-pill').textContent).toContain('Vorfall');
    expect(screen.getByTestId('data-geometry-pill').textContent).toContain('Punkt');
  });
  it('a form has no geometry pill', () => {
    mount(state({ shape: { map: false } }));
    expect(screen.getByTestId('data-type-pill').textContent).toContain('Umfrage');
    expect(screen.queryByTestId('data-geometry-pill')).toBeNull();
  });
  it('a Tabelle has no shape at all: no pill', () => {
    mount(state({ shape: undefined as never }));
    expect(screen.queryByTestId('data-type-pill')).toBeNull();
    expect(screen.queryByTestId('data-geometry-pill')).toBeNull();
  });
  it('changing the geometry sends the call and, with objects, shows the note about the deploy overview', async () => {
    const onCall = mount(state({ featureCount: 12 }));
    expect(screen.queryByTestId('data-shape-note')).toBeNull();
    await userEvent.click(screen.getByTestId('data-geometry-pill'));
    await userEvent.click(await screen.findByTestId('data-geometry-polygon'));
    expect(onCall).toHaveBeenCalledWith({ action: 'geometry', kind: 'polygon' });
    const note = await screen.findByTestId('data-shape-note');
    expect(note.textContent).toContain('12 Objekte');
    expect(note.textContent).toContain('Veröffentlichen');
  });
  it('without objects there is no note', async () => {
    mount(state());
    await userEvent.click(screen.getByTestId('data-geometry-pill'));
    await userEvent.click(await screen.findByTestId('data-geometry-polygon'));
    await waitFor(() => expect(screen.queryByTestId('data-shape-note')).toBeNull());
  });
});

describe('without a header', () => {
  it('shows the name only, nothing editable', () => {
    mount(undefined);
    expect(screen.queryByTestId('data-name')).toBeNull();
    expect(screen.queryByTestId('data-private')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Baum' })).toBeTruthy();
  });
});
