<script lang="ts">
  // The admin area (v3 `+layout.svelte`): the shell around every admin page, except the login page (as in v3).
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, onMount } from 'svelte';
  import { authSync } from './auth-sync';
  import { mode, setMode } from 'mode-watcher';
  import type { Snippet } from 'svelte';
  import { setUiLocale } from '@ueberblick/ui';
  import { Toaster } from '@ueberblick/ui/components/ui/sonner';
  import AdminShell from './shell/AdminShell.svelte';
  import { storeLocale } from './shell/preferences';
  import type { Locale } from './shell/locale';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const isLoginPage = $derived(page.url.pathname === '/admin/login');

  // The ui package keeps its own language (kit strings: form 'Choose', table texts). The admin's single source is the
  // `ub_locale` cookie, read into `data.locale`; this hands it to the kit before the pages below render, on the server
  // (one synchronous pass per request) and in the browser. Message calls are not reactive, so `{#key}` below remounts
  // the page when the language switches.
  const uiLocale = $derived.by(() => {
    setUiLocale(data.locale);
    return data.locale;
  });
  onDestroy(() => setUiLocale(undefined));

  // hooks.server.ts sets <html lang> from Accept-Language only; the chosen language wins here.
  $effect(() => {
    document.documentElement.lang = data.locale;
  });

  // v3 `+layout.svelte:300-312` (`onAuthStateChange`): signing out in one tab sends the others to the login page;
  // signing in on one tab lets a waiting login page go on.
  const sync = authSync();
  onMount(() => {
    const stop = sync.listen((event) => {
      if (event === 'signed-out' && !isLoginPage) {
        void goto('/admin/login', { replaceState: true, invalidateAll: true });
      }
      if (event === 'signed-in' && isLoginPage) void invalidateAll();
    });
    return () => {
      stop();
      sync.close();
    };
  });

  async function signOut(): Promise<void> {
    await fetch('/admin/logout', { method: 'POST', redirect: 'manual' }).catch(() => undefined);
    sync.post('signed-out');
    await goto('/admin/login', { replaceState: true, invalidateAll: true });
  }

  // A language switch remounts the page, which would drop unsaved work (the builder's draft edits). It goes through a
  // navigation to the same address, so a page's `beforeNavigate` guard (the builder's "unsaved changes" confirm) asks
  // first; when it cancels, the data keeps the old language and the cookie goes back.
  async function chooseLocale(locale: Locale): Promise<void> {
    const before = data.locale;
    storeLocale(locale);
    await goto(page.url, { invalidateAll: true, replaceState: true, keepFocus: true, noScroll: true });
    if (data.locale !== locale) storeLocale(before);
  }
</script>

<div class="admin-theme">
  <Toaster />
  {#key uiLocale}
    {#if isLoginPage}
      {@render children()}
    {:else}
      <AdminShell
        locale={data.locale}
        pathname={page.url.pathname}
        account={data.account}
        projects={data.projects}
        currentProject={data.currentProject}
        types={data.types}
        navigate={(href) => void goto(href)}
        refresh={() => invalidateAll()}
        theme={mode.current === 'dark' ? 'dark' : 'light'}
        onTheme={(theme) => setMode(theme)}
        onLocale={(locale) => void chooseLocale(locale)}
        onSignOut={() => void signOut()}
      >
        {@render children()}
      </AdminShell>
    {/if}
  {/key}
</div>
