<script lang="ts">
  // v3's participant sign-in (reference/src/routes/(participant)/login/+page.svelte): token tab, QR tab, language
  // and theme switch, error texts. Ports: `fetch` (the exchange), `load` (the QR decoder), `go` (navigation), `leave` (full document navigation back to a guest link: /login's no-referrer policy must not follow the join POST, WP-786).
  import { onMount } from 'svelte';
  import { toggleMode, mode } from 'mode-watcher';
  import AlertCircle from '@lucide/svelte/icons/alert-circle';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Languages from '@lucide/svelte/icons/languages';
  import Moon from '@lucide/svelte/icons/moon';
  import QrCode from '@lucide/svelte/icons/qr-code';
  import Sun from '@lucide/svelte/icons/sun';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Card from '@ueberblick/ui/components/ui/card';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import * as Tabs from '@ueberblick/ui/components/ui/tabs';
  import { message, type Locale } from '../messages';
  import ConsentModal from './ConsentModal.svelte';
  import { decide, gateIsClosed, loadConsent, type ConsentState } from './consent';
  import { exchange, type FetchLike, type Problem } from './exchange';
  import { deviceLocale, storeLocale } from './locale';
  import logo from './logo-light.png';
  import QrTab from './QrTab.svelte';
  import { tokenFromLocation } from './scan';
  import type { LoadScanner } from './scanner';

  let {
    fetch,
    load,
    go,
    leave,
  }: {
    fetch: FetchLike;
    load: LoadScanner;
    go: (path: string) => void | Promise<void>;
    leave: (path: string) => void | Promise<void>;
  } = $props();

  let locale: Locale = $state(deviceLocale());
  let tab = $state('token');
  let token = $state('');
  let showToken = $state(false);
  let working = $state(false);
  let problem: Problem | undefined = $state();
  // v3's field error under the input (its zod `min(1)`), shown instead of the browser's own bubble.
  let tokenMissing = $state(false);
  // The consent gate (WP-638): while it is closed nothing is sent, a ?token= link waits in `pending`.
  let consent: ConsentState | undefined = $state();
  let pending: string | undefined;
  let deciding = $state(false);
  let decisionFailed = $state(false);
  // A guest link that needed consent sends the visitor here (WP-639, v3 join `?returnTo=`): back to it once accepted.
  let returnTo: string | undefined;
  const dark = $derived(mode.current === 'dark');

  async function signIn(value: string): Promise<void> {
    working = true;
    problem = undefined;
    const result = await exchange(fetch, value);
    if (result.ok) {
      try {
        await go('/map');
      } catch (err) {
        console.error('Navigation after sign-in failed:', err);
        working = false;
        problem = { key: 'login_err_generic' };
      }
      return;
    }
    working = false;
    if (result.consentRequired) {
      // The cookie is gone or was never set: ask again, and sign in once it is given.
      pending = value;
      consent = await loadConsent(fetch);
      return;
    }
    problem = result.problem;
  }

  async function decision(choice: 'accepted' | 'rejected'): Promise<void> {
    deciding = true;
    decisionFailed = !(await decide(fetch, choice));
    deciding = false;
    if (decisionFailed || choice === 'rejected' || consent === undefined) return;
    consent = { ...consent, accepted: true };
    if (returnTo !== undefined) {
      await leave(returnTo);
      return;
    }
    const waiting = pending;
    pending = undefined;
    if (waiting !== undefined) await signIn(waiting);
  }

  /** A scanned code goes to the token field and is submitted, as in v3. */
  async function scanned(value: string): Promise<void> {
    token = value;
    tab = 'token';
    // Signs in directly: a submit through the form needs the token tab's form to be mounted, and when it was not (a
    // loaded device) the scan vanished without a word (WP-867).
    tokenMissing = value.trim() === '';
    if (!tokenMissing && !working) await signIn(value.trim());
  }

  function setLocale(value: string): void {
    locale = value === 'en' ? 'en' : 'de';
    storeLocale(locale);
  }

  onMount(() => {
    // v3 `+page.svelte:376`: the sign-in page does not scroll; released when the page is left.
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    storeLocale(locale);
    const link = tokenFromLocation(location.search);
    const back = new URLSearchParams(location.search).get('returnTo');
    if (back !== null && back.startsWith('/join/') && !back.startsWith('//') && !back.includes('\\'))
      returnTo = back;
    // The token leaves the address and the history before anything else happens.
    if (link !== undefined) {
      history.replaceState(null, '', location.pathname);
      token = link;
    }
    void (async () => {
      consent = await loadConsent(fetch);
      if (returnTo !== undefined && !gateIsClosed(consent)) {
        await leave(returnTo);
        return;
      }
      if (link === undefined) return;
      if (gateIsClosed(consent)) pending = link;
      else await signIn(link);
    })();
    return () => {
      document.body.style.overflow = before;
    };
  });
</script>

<svelte:head><title>{message(locale, 'login_title')} - Überblick</title></svelte:head>

<div
  class="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900"
>
  <div class="fixed top-4 right-4 flex items-center gap-2">
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="outline"
            size="sm"
            class="gap-2"
            aria-label={message(locale, 'login_language')}
          >
            <Languages class="h-4 w-4" />
            {message(locale, locale === 'de' ? 'login_language_de' : 'login_language_en')}
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-36">
        <DropdownMenu.RadioGroup value={locale} onValueChange={setLocale}>
          <DropdownMenu.RadioItem value="en">{message(locale, 'login_language_en')}</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="de">{message(locale, 'login_language_de')}</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
    <Button
      variant="outline"
      size="icon"
      onclick={toggleMode}
      aria-label={message(locale, dark ? 'login_theme_to_light' : 'login_theme_to_dark')}
    >
      {#if dark}<Sun class="h-5 w-5" />{:else}<Moon class="h-5 w-5" />{/if}
    </Button>
  </div>

  <Card.Root class="w-full max-w-md">
    <Card.Header class="space-y-1 text-center">
      <img
        src={logo}
        alt={message(locale, 'login_logo_alt')}
        class="mx-auto mb-4 h-16 w-16 object-contain dark:invert"
      />
      <Card.Title class="text-2xl font-bold">
        <h1>{message(locale, 'login_title')}</h1>
      </Card.Title>
      <Card.Description>{message(locale, 'login_subtitle')}</Card.Description>
    </Card.Header>

    <Card.Content>
      <Tabs.Root bind:value={tab} class="w-full">
        <Tabs.List class="grid w-full grid-cols-2">
          <Tabs.Trigger value="token">
            <KeyRound class="mr-2 h-4 w-4" />
            {message(locale, 'login_tab_token')}
          </Tabs.Trigger>
          <Tabs.Trigger value="qr">
            <QrCode class="mr-2 h-4 w-4" />
            {message(locale, 'login_tab_qr')}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="token" class="mt-4">
          <form
            class="space-y-4"
            novalidate
            onsubmit={(event) => {
              event.preventDefault();
              tokenMissing = token.trim() === '';
              if (!tokenMissing) void signIn(token.trim());
            }}
          >
            <div class="space-y-2">
              <Label for="token">{message(locale, 'login_token_label')}</Label>
              <div class="relative">
                <Input
                  id="token"
                  name="token"
                  type={showToken ? 'text' : 'password'}
                  placeholder={message(locale, 'login_token_placeholder')}
                  autocomplete="current-password"
                  autocapitalize="none"
                  spellcheck={false}
                  bind:value={token}
                  oninput={() => (tokenMissing = false)}
                  aria-invalid={tokenMissing}
                  aria-describedby={tokenMissing ? 'token-error' : undefined}
                  class="pr-10 {tokenMissing ? 'border-destructive' : ''}"
                  data-testid="token-input"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  onclick={() => (showToken = !showToken)}
                  aria-label={message(locale, showToken ? 'login_hide_token' : 'login_show_token')}
                >
                  {#if showToken}<EyeOff class="h-4 w-4" />{:else}<Eye class="h-4 w-4" />{/if}
                </button>
              </div>
              {#if tokenMissing}
                <p id="token-error" class="text-sm text-destructive">
                  {message(locale, 'login_token_required')}
                </p>
              {/if}
            </div>

            {#if problem !== undefined}
              <div
                role="alert"
                class="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle class="h-4 w-4 shrink-0" />
                <span>{message(locale, problem.key, problem.values)}</span>
              </div>
            {/if}

            <Button type="submit" class="w-full" disabled={working} data-testid="login-button">
              {message(locale, working ? 'login_submitting' : 'login_submit')}
            </Button>
          </form>

          <p class="mt-4 text-center text-sm text-muted-foreground">
            {message(locale, 'login_or')}
            <button type="button" class="text-primary hover:underline" onclick={() => (tab = 'qr')}>
              {message(locale, 'login_switch_to_qr')}
            </button>
          </p>
        </Tabs.Content>

        <Tabs.Content value="qr" class="mt-4">
          <!-- mounted only while open: the decoder loads on first open and the camera stops on leaving -->
          {#if tab === 'qr'}
            <QrTab {locale} {load} onToken={scanned} onSwitch={() => (tab = 'token')} />
          {/if}
        </Tabs.Content>
      </Tabs.Root>
    </Card.Content>
  </Card.Root>
</div>

{#if gateIsClosed(consent) && consent !== undefined}
  <ConsentModal gate={consent} {locale} busy={deciding} failed={decisionFailed} onDecide={decision} />
{/if}
