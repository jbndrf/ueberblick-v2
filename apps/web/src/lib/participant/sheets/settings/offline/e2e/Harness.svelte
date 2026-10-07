<script lang="ts">
  // Einstellungen on its Offline tab with the real tab and the real download card (the context comes from
  // `main.testing.ts`). Test fixture only.
  import SettingsSheet from '../../SettingsSheet.svelte';
  import OfflineTab from '../OfflineTab.svelte';
  import DownloadCard from '../../../../offline/DownloadCard.svelte';
  import type { OfflineContext } from '../../../../offline/context';
  import { createDevicePrefs } from '../../prefs';
  import type { SettingsDevice } from '../../device';

  let { context }: { context: OfflineContext } = $props();

  try {
    localStorage.setItem('ueberblick:ui-tab:settings', 'offline');
  } catch {
    // no storage: the tab opens on Profil and the spec fails visibly
  }

  const quiet = (): (() => void) => () => undefined;
  const device = {
    participant: { id: 'anna', name: 'Anna', roles: ['pruefer'], email: null, phone: null },
    identity: { login: null, infoPages: [], legalPages: [] },
    clock: { now: () => '2026-10-01T12:00:00Z' },
    queue: {
      status: () => ({ pending: 0, refused: [], review: [] }),
      subscribe: quiet,
      discard: async () => undefined,
      resubmit: async () => ({ ok: true, orders: [1], created: {} }),
    },
    changed: { subscribe: quiet },
    store: { readRuns: async () => [], facts: { feature: () => undefined } },
    problems: { list: () => [], subscribe: quiet },
    sync: {
      syncNow: async () => undefined,
      worker: { status: () => ({ phase: 'idle', featuresLoaded: 4711 }), subscribe: quiet },
    },
  } as unknown as SettingsDevice;
  const prefs = createDevicePrefs({
    storage: localStorage,
    prefersDark: () => false,
    deviceLocale: 'de',
  });
  let open = $state(true);
</script>

<SettingsSheet
  bind:open
  {device}
  locale="de"
  {prefs}
  online={true}
  taskLabel={(k) => k}
  roleLabel={(k) => k}
  onjump={() => undefined}
  onsignout={async () => true}
  onlocale={() => undefined}
  {offline}
/>
<DownloadCard offline={context.offline} locale="de" />

{#snippet offline()}
  <OfflineTab {context} locale="de" records={4711} />
{/snippet}
