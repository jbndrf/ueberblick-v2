/** Test support for the Teilnehmende page specs: jsdom shims, viewport, a fake api and the page's data. */
import { vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import ParticipantsPage from './ParticipantsPage.svelte';
import type { ParticipantsApi } from './api';
import type { ParticipantsPageData } from './types';

/** The virtualiser measures the scroll area; jsdom has no layout, so give it a size. */
export function shimLayout(): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-scroll') ? 600 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-scroll') ? 1000 : 0;
    },
  });
}

/** v3 switches layout at 768 px; the journeys use 390 x 844 and 1280 x 800. */
export function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: width < 768 ? 844 : 800 });
}

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

export function fakeApi(over: Partial<ParticipantsApi> = {}): {
  [K in keyof ParticipantsApi]: ReturnType<typeof vi.fn>;
} {
  return {
    add: vi.fn(() => ok({ id: 'new-1' })),
    patch: vi.fn(() => ok(null)),
    remove: vi.fn(() => ok(null)),
    setToken: vi.fn(() => ok({ token: 'NEW-TOKEN' })),
    revokeToken: vi.fn(() => ok(null)),
    saveColumns: vi.fn(() => ok(null)),
    createRole: vi.fn((name: string) => ok({ key: 'neu', label: name, pending: true })),
    ...over,
  } as never;
}

export const DATA: ParticipantsPageData = {
  people: [
    {
      id: 'anna-1',
      name: 'Anna',
      email: 'anna@example.org',
      phone: null,
      roles: ['kontrolle'],
      attrs: {},
      disabledAt: null,
      selfJoined: false,
      token: 'AAAA-AAAA',
    },
    {
      id: 'bernd-2',
      name: 'Bernd',
      email: null,
      phone: '0151',
      roles: [],
      attrs: {},
      disabledAt: '2026-01-01T00:00:00Z',
      selfJoined: false,
      token: 'BBBB-BBBB',
    },
    {
      id: 'clara-3',
      name: 'Clara',
      email: null,
      phone: null,
      roles: ['kontrolle', 'praktikum'],
      attrs: {},
      disabledAt: null,
      selfJoined: false,
      token: null,
    },
  ],
  roles: [
    { key: 'kontrolle', label: 'Kontrolle', pending: false },
    { key: 'melder', label: 'Melder', pending: false },
    { key: 'praktikum', label: 'Praktikum', pending: true },
  ],
  columns: [],
  columnTypes: ['text', 'number', 'boolean', 'date'],
  showGuests: false,
};

export function mount(
  over: { data?: Partial<ParticipantsPageData>; api?: ReturnType<typeof fakeApi>; locale?: 'de' | 'en' } = {},
) {
  const api = over.api ?? fakeApi();
  const reload = vi.fn(() => Promise.resolve());
  const onGuests = vi.fn();
  const view = render(ParticipantsPage, {
    data: { ...DATA, ...over.data },
    locale: over.locale ?? 'de',
    origin: 'https://ueb.test',
    api: api as unknown as ParticipantsApi,
    reload,
    onGuests,
  });
  return { ...view, api, reload, onGuests };
}

export const rowOf = (id: string): HTMLElement =>
  document.querySelector(`[data-row-id="${id}"]`) as HTMLElement;

/**
 * Open menus count as hidden to testing-library in jsdom (no layout, floating-ui parks them off-screen), and the accessible
 * name of a hidden node comes out empty: find overlay items by role and visible text.
 */
export async function overlayItems(role: string): Promise<HTMLElement[]> {
  return waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(`[role=${role}]`)];
    if (found.length === 0) throw new Error(`no ${role} yet`);
    return found;
  });
}

export async function overlayItem(role: string, name: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(`[role=${role}]`)].find(
      (e) => e.textContent?.trim() === name,
    );
    if (!found) throw new Error(`no ${role} ${name}`);
    return found;
  });
}
