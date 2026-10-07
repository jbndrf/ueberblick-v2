/** Test support for the Rollen page specs: a fake api and the page's data (jsdom shims live in the participants testkit). */
import { vi } from 'vitest';
import { render } from '@testing-library/svelte';
import RolesPage from './RolesPage.svelte';
import type { RolesApi } from './api';
import type { RolesPageData } from './types';

export { overlayItem, overlayItems, rowOf, setViewport, shimLayout } from '../participants/page.testkit';

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

export function fakeApi(over: Partial<RolesApi> = {}): { [K in keyof RolesApi]: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(() => ok({ key: 'gutachter' })),
    update: vi.fn((key: string) => ok({ key })),
    preview: vi.fn(() => ok({ uses: [], people: [] })),
    setSelfJoin: vi.fn((_role: string, enabled: boolean) => ok({ enabled, slug: 'abc123def0' })),
    setQuota: vi.fn((key: string) => ok({ key })),
    remove: vi.fn(() => ok(null)),
    setMembers: vi.fn(() => ok(null)),
    createPerson: vi.fn(() => ok({ id: 'dora-9' })),
    ...over,
  } as never;
}

export const DATA: RolesPageData = {
  roles: [
    {
      key: 'kontrolle',
      label: 'Baumkontrolle',
      description: 'Kontrolliert Bäume',
      members: ['anna-1', 'clara-3'],
      selfJoin: { enabled: true, slug: 'baum-kontrolle' },
      quota: 3,
      home: 'Karte',
    },
    { key: 'bauhof', label: 'Bauhof', description: '', members: [], selfJoin: null, quota: 0, home: '' },
  ],
  people: [
    { id: 'anna-1', name: 'Anna' },
    { id: 'bernd-2', name: 'Bernd' },
    { id: 'clara-3', name: 'Clara' },
  ],
};

export function mount(
  over: { data?: Partial<RolesPageData>; api?: ReturnType<typeof fakeApi>; locale?: 'de' | 'en' } = {},
) {
  const api = over.api ?? fakeApi();
  const reload = vi.fn(() => Promise.resolve());
  const view = render(RolesPage, {
    data: { ...DATA, ...over.data },
    locale: over.locale ?? 'de',
    api: api as unknown as RolesApi,
    reload,
  });
  return { ...view, api, reload };
}
