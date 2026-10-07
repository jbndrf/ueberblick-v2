<script lang="ts">
  // The participant's home: bootstrap (who, which project, the compiled config), then the device runtime as one lazy
  // chunk (store, run queue, sync and core geo), then the app. The shell chunk holds none of that.
  import { onDestroy, onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { loadBootstrap, localBootstrapCache } from '$lib/participant/http';
  import { message, type Locale } from '$lib/participant/messages';
  import { deviceLocale, storeLocale } from '$lib/participant/login/locale';
  import { signOutSession, startSession, type SessionDeps } from '$lib/participant/session';
  import { listenSessionChanged } from '$lib/participant/session-channel';
  import { sessionEnded } from '$lib/participant/session-end';
  import type { Device } from '$lib/participant/device';
  import MapScreen from '$lib/participant/shell/MapScreen.svelte';
  import InsecureNotice from '$lib/participant/InsecureNotice.svelte';
  import { httpsAddress, type StartupNotice } from '$lib/participant/insecure';

  type State = 'loading' | 'ready' | 'failed' | StartupNotice;
  let phase: State = $state('loading');
  let device: Device | undefined = $state();
  let invalid: string | undefined = $state();
  // The person's own pick (sign-in page switch, Einstellungen Optionen: one key) wins over the cookie and the browser.
  let locale: Locale = $state(deviceLocale());

  /** The person picked another language: the app re-renders in it, and so do the design system's strings. */
  function changeLocale(next: Locale): void {
    locale = next;
    storeLocale(next);
  }

  function sessionDeps(): SessionDeps {
    return {
      bootstrap: () => loadBootstrap((input, init) => fetch(input, init)),
      load: async () => {
        const [{ switchDevice }, { browserPorts }, { quietOfflineLog }] = await Promise.all([
          import('$lib/participant/device-switch'),
          import('$lib/participant/browser'),
          import('$lib/participant/sync-log'),
        ]);
        // Being offline is expected: a failed fetch is logged once per offline period (WP-731).
        const quiet = quietOfflineLog((where, error) => console.error(`participant ${where}:`, error));
        window.addEventListener('online', () => quiet.backOnline());
        return { switchDevice, ports: () => browserPorts(quiet.report) };
      },
      ...(device === undefined ? {} : { current: device }),
      locale,
    };
  }

  async function start(): Promise<void> {
    phase = 'loading';
    invalid = undefined;
    // The design system's strings follow the device language (its Paraglide strategy reads this cookie).
    storeLocale(locale);
    const started = await startSession(sessionDeps());
    if (started.kind === 'signed_out') {
      device?.close(); // an open device of the person before is closed: its data is not shown to whoever comes next
      device = undefined;
      await goto('/login', { replaceState: true });
    } else if (started.kind === 'ready') {
      device = started.device;
      phase = 'ready';
    } else if (started.kind === 'failed') {
      if (started.invalid !== undefined) {
        console.error('participant bootstrap refused:', started.invalid);
        invalid = started.invalid;
      }
      phase = 'failed';
    } else phase = started.notice;
  }

  /** True once signed out. Offline it is false: the session and the local copy stand, and the sheet says so (WP-769). */
  async function signOut(): Promise<boolean> {
    const open = device;
    try {
      await signOutSession(
        (input, init) => fetch(input, init),
        localBootstrapCache(),
        async () => {
          if (open === undefined) return;
          open.close(); // a database that is open cannot be deleted
          const { wipeParticipantDevice } = await import('$lib/participant/wipe');
          const { clearPackScope } = await import('@ueberblick/client');
          await wipeParticipantDevice(
            { project: open.identity.project.key, participant: open.identity.participant.id },
            {
              idb: indexedDB,
              storage: localStorage,
              clearPacks: (scope) => clearPackScope(navigator, scope),
            },
          );
        },
      );
    } catch {
      return false;
    }
    device = undefined;
    await goto('/login', { replaceState: true });
    return true;
  }

  // The server ended the session (401 on sync or on sending runs): back to /login. The queued runs stay on the device
  // for this person; nothing is wiped (WP-769).
  $effect(() => {
    const open = device;
    if (open === undefined) return;
    const check = (): void => {
      if (!sessionEnded(open.queue.status(), open.sync.worker.status())) return;
      localBootstrapCache()?.clear();
      open.close();
      device = undefined;
      void goto('/login', { replaceState: true });
    };
    const stops = [open.queue.subscribe(check), open.sync.worker.subscribe(check)];
    return () => stops.forEach((stop) => stop());
  });

  // A pull ended in a scope change, or the person synced now: the roles are read again and a changed set is applied to
  // the open device in place (WP-796; v3's live `roles` collection, `map/+page.svelte:405`): `startSession` hands back
  // the same device, so nothing remounts and open sheets stay. Only another person replaces it (`{#key device}`).
  // Failures are quiet: the session ends elsewhere, and the old roles stand until the next sync.
  $effect(() => {
    const open = device;
    if (open === undefined) return;
    return open.onAccessCheck(() => {
      void startSession(sessionDeps()).then((started) => {
        if (started.kind === 'ready') {
          if (started.device !== device) device = started.device;
        } else console.error('participant roles refresh:', started);
      });
    });
  });

  // Another tab signed in, or this device found the cookie turned to another participant (WP-768): bootstrap again.
  // The same person keeps the open device; another one replaces it (`switchDevice`), no one goes to the sign-in page.
  let stopListening: (() => void) | undefined;
  onMount(() => {
    stopListening = listenSessionChanged(() => void start());
    void start();
  });
  onDestroy(() => {
    stopListening?.();
    device?.close();
  });
</script>

<svelte:head><title>Überblick</title></svelte:head>

{#if phase === 'ready' && device}
  {#key device}
    <MapScreen {device} {locale} onsignout={signOut} onlocale={changeLocale} />
  {/key}
{:else}
  <main>
    {#if phase === 'loading'}
      <p role="status">{message(locale, 'loading')}</p>
    {:else if phase === 'insecure_context'}
      <InsecureNotice {locale} address={httpsAddress(location)} />
    {:else}
      <p role="alert">{message(locale, 'load_failed')}</p>
      {#if invalid !== undefined}<p role="alert">
          {message(locale, 'load_invalid', { reason: invalid })}
        </p>{/if}
      <button type="button" onclick={() => void start()}>{message(locale, 'reload')}</button>
    {/if}
  </main>
{/if}

<style>
  main {
    max-width: 32rem;
    margin: 0 auto;
    padding: 24px 16px;
    font:
      1rem/1.5 system-ui,
      sans-serif;
  }
  button {
    min-height: 56px;
    padding: 0 16px;
    font: inherit;
    font-weight: 600;
  }
</style>
