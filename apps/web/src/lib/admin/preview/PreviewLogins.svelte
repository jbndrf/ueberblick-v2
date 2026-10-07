<script lang="ts">
  // v3's "Vorschau-Logins" card of the release page (`fork/+page.svelte:297-312`, styles `:463-490`): one row per role plus
  // "Keine Rolle" with the login link in a `code` box and v3's "Link kopieren" button that turns into "Kopiert!" for 1.5 s.
  // v3 had the card next to "Release"; v4 has it in the deploy overview, the successor of that card, and on "Status & Freigabe"
  // (v3's page "Entwurf — Vorschau & Release"), usable before any publish. The links stay valid
  // across a publish (owner V4), so the hint says so. "Demo-Daten zurücksetzen" (owner V1) is the one extra button, in the
  // place where v3's card row of "Fork verwerfen" sat: it asks first, because it throws the testers' entries away.
  import { onMount } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { DeployClient } from '../deploy/deploy-client';
  import type { PreviewView } from './types';

  interface Props {
    locale: Locale;
    client: Pick<DeployClient, 'preview' | 'resetPreview'>;
  }
  let { locale, client }: Props = $props();
  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  let view = $state<PreviewView | null>(null);
  let loading = $state(true);
  let copiedId = $state<string | null>(null);
  let confirming = $state(false);
  let resetting = $state(false);
  let failed = $state<'load' | 'reset' | null>(null);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const linkOf = (relative: string): string => `${origin}${relative}`;

  onMount(() => {
    void client.preview(locale).then((v) => {
      view = v;
      failed = v === null ? 'load' : null;
      loading = false;
    });
  });

  async function copy(id: string, relative: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(linkOf(relative));
      copiedId = id;
      setTimeout(() => (copiedId === id ? (copiedId = null) : null), 1500);
    } catch {
      /* clipboard unavailable: the link stays readable in its box */
    }
  }

  async function reset(): Promise<void> {
    resetting = true;
    const next = await client.resetPreview(locale);
    resetting = false;
    confirming = false;
    if (next === null) failed = 'reset';
    else {
      view = next;
      failed = null;
    }
  }
</script>

<section class="mt-3 rounded-lg border p-3" aria-labelledby="preview-logins" data-testid="preview-logins">
  <h3 id="preview-logins" class="text-sm font-semibold">{t('preview_title')}</h3>
  {#if loading}
    <p class="mt-1 flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <Loader2 class="size-3.5 animate-spin" />
    </p>
  {:else if view === null || view.logins.length === 0}
    <p class="mt-1 text-xs text-muted-foreground" role={failed === 'load' ? 'alert' : 'status'}>
      {failed === 'load' ? t('preview_load_failed') : t('preview_none')}
    </p>
  {:else}
    <p class="mt-1 text-xs text-muted-foreground">{t('preview_hint')}</p>
    <ul class="mt-2 flex flex-col gap-2">
      {#each view.logins as login (login.participantId)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="preview-login">
          <span class="min-w-24 text-sm font-medium"
            >{login.role === null ? t('preview_no_role') : login.label}</span
          >
          <code
            class="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 text-xs"
            data-testid="preview-login-link">{linkOf(login.link)}</code
          >
          <Button
            variant="outline"
            size="sm"
            class="min-h-11 sm:min-h-8"
            onclick={() => void copy(login.participantId, login.link)}
          >
            {#if copiedId === login.participantId}
              <Check class="mr-1 size-3.5" />{t('preview_copied')}
            {:else}
              <Copy class="mr-1 size-3.5" />{t('preview_copy')}
            {/if}
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if failed === 'reset'}
    <p class="mt-2 text-xs text-destructive" role="alert">{t('preview_reset_failed')}</p>
  {/if}
  {#if view !== null && view.status !== 'dropped'}
    <div class="mt-2 flex justify-end">
      <Button
        variant="ghost"
        size="sm"
        class="min-h-11 sm:min-h-8"
        disabled={resetting}
        onclick={() => (confirming = true)}
      >
        {#if resetting}<Loader2 class="mr-1 size-3.5 animate-spin" />{:else}<RotateCcw
            class="mr-1 size-3.5"
          />{/if}
        {t('preview_reset')}
      </Button>
    </div>
  {/if}
</section>

<AlertDialog.Root bind:open={confirming}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{t('preview_reset_title')}</AlertDialog.Title>
      <AlertDialog.Description>{t('preview_reset_confirm')}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{t('preview_reset_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action onclick={() => void reset()}>{t('preview_reset')}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
