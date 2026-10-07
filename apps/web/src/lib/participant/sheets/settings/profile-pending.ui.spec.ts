// @vitest-environment jsdom
// The Profil header counts only runs that wait for the upload (v3 `countOpenTaskRuns`: queued + sending,
// task-run-queue.svelte.ts:86-93); a refused or dependent run shows its state in its own row instead.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import '@ueberblick/ui/testing';
import ProfileTab from './ProfileTab.svelte';
import { storedRun } from './fake-device.testing';
import { queueRows } from './queue-rows';

afterEach(cleanup);

const refusal = { code: 'not_permitted', message: 'Not allowed' };
const noop = (): void => undefined;

function mount(runs: ReturnType<typeof storedRun>[]): void {
  render(ProfileTab, {
    locale: 'de',
    participant: { id: 'p1', name: 'Pia', roles: [], email: null },
    roleLabel: (k: string) => k,
    infoPages: [],
    legalPages: [],
    online: true,
    syncing: false,
    freshness: { ago: undefined, staleDays: undefined },
    hasSynced: false,
    syncError: undefined,
    rows: queueRows(runs, { sending: undefined }, (k) => k, 'de'),
    onsyncnow: noop,
    onjump: noop,
    onresend: noop,
    ondiscard: noop,
    onsignout: noop,
    onpage: noop,
  });
}

describe('Profil header count', () => {
  it('two refused runs wait for nothing: no upload line', () => {
    mount([
      storedRun('a', 1, 'refused', { task: 't', refusal }),
      storedRun('b', 2, 'dependent', { task: 't', refusal }),
    ]);
    expect(screen.queryByText(/warten auf den Upload/)).toBeNull();
  });

  it('counts only queued runs next to refused and dependent ones', () => {
    mount([
      storedRun('a', 1, 'refused', { task: 't', refusal }),
      storedRun('b', 2, 'dependent', { task: 't', refusal }),
      storedRun('c', 3, 'queued', { task: 't' }),
    ]);
    expect(screen.getByText('1 nicht gespeicherte Änderung(en) warten auf den Upload.')).toBeTruthy();
  });
});
