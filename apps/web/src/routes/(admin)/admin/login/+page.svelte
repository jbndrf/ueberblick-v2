<script lang="ts">
  // Admin sign-in (v3 `login/+page.svelte`): the card over a soft gradient, language and theme at the top right.
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { mode, setMode } from 'mode-watcher';
  import { enrolQr, signIn } from '../../../(builder)/admin-login';
  import { adminMessage } from '../shell/messages';
  import { storeLocale } from '../shell/preferences';
  import { authSync } from '../auth-sync';
  import type { Locale } from '../shell/locale';
  import LoginCard from './LoginCard.svelte';
  import LoginControls from './LoginControls.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // v3 `login/+page.svelte:156`: `body { overflow: hidden }`, only while this page is shown.
  onMount(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  });

  async function signedIn(): Promise<void> {
    const sync = authSync();
    sync.post('signed-in');
    sync.close();
    await goto(data.redirectTo, { replaceState: true, invalidateAll: true });
  }

  async function chooseLocale(locale: Locale): Promise<void> {
    storeLocale(locale);
    await invalidateAll();
  }
</script>

<svelte:head
  ><title>{adminMessage(data.locale, 'login_title')} - {adminMessage(data.locale, 'product')}</title
  ></svelte:head
>

<div
  class="flex h-dvh overflow-y-auto bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 p-4 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900"
>
  <LoginControls
    locale={data.locale}
    theme={mode.current === 'dark' ? 'dark' : 'light'}
    onTheme={(theme) => setMode(theme)}
    onLocale={(locale) => void chooseLocale(locale)}
  />
  <div class="m-auto w-full max-w-md">
    <LoginCard
      locale={data.locale}
      totp={data.totp}
      rememberDays={data.rememberDays}
      qr={enrolQr}
      submit={(credentials) => signIn((input, init) => fetch(input, init), credentials)}
      onsignedin={() => void signedIn()}
    />
  </div>
</div>
