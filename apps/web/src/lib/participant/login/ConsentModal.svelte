<script lang="ts">
  // v3's consent modal (reference/src/lib/components/consent-modal.svelte): title and body, the legal pages of the
  // consent footer readable in place, Reject and Accept. Not dismissable: only a decision closes it.
  import { LAYER } from '../layers';
  import { onMount } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { message, type Locale } from '../messages';
  import type { ConsentState, FooterPage } from './consent';
  import { sanitizeHtml } from './sanitize-html';

  let {
    gate,
    locale,
    busy = false,
    failed = false,
    onDecide,
  }: {
    gate: ConsentState;
    locale: Locale;
    busy?: boolean;
    failed?: boolean;
    onDecide: (decision: 'accepted' | 'rejected') => void;
  } = $props();

  let page: FooterPage | undefined = $state();
  let root: HTMLElement | undefined = $state();

  onMount(() => root?.focus());
</script>

<div class={['fixed inset-0 flex items-center justify-center bg-black/60 p-4', LAYER.top]}>
  <div
    bind:this={root}
    role="dialog"
    aria-modal="true"
    aria-labelledby="consent-heading"
    tabindex="-1"
    data-testid="consent-modal"
    class="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-background shadow-xl outline-none"
  >
    {#if page !== undefined}
      <div class="flex items-center gap-2 border-b px-4 py-3">
        <h2 id="consent-heading" class="sr-only">{page.title}</h2>
        <Button variant="ghost" size="sm" class="-ml-2" onclick={() => (page = undefined)}>
          <ArrowLeft class="mr-1 h-4 w-4" />
          {message(locale, 'consent_back')}
        </Button>
      </div>
      <div class="overflow-y-auto p-6">
        <article class="break-words">{@html sanitizeHtml(page.body)}</article>
      </div>
    {:else}
      <div class="overflow-y-auto p-6">
        <h1 id="consent-heading" class="mb-4 text-xl font-semibold">
          {gate.title || message(locale, 'consent_title')}
        </h1>
        {#if gate.body}
          <div class="text-sm break-words">{@html sanitizeHtml(gate.body)}</div>
        {:else}
          <p class="text-sm text-muted-foreground">{message(locale, 'consent_body')}</p>
        {/if}
        {#if failed}
          <p role="alert" class="mt-4 text-sm text-destructive">{message(locale, 'login_err_offline')}</p>
        {/if}
      </div>

      {#if gate.footerPages.length > 0}
        <div class="flex flex-wrap gap-x-4 gap-y-1 border-t bg-muted/30 px-6 py-3 text-xs">
          {#each gate.footerPages as footer (footer.slug)}
            <button
              type="button"
              class="text-primary underline-offset-4 hover:underline"
              onclick={() => (page = footer)}
            >
              {footer.title}
            </button>
          {/each}
        </div>
      {/if}

      <div class="flex flex-col gap-2 border-t p-4 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={busy} onclick={() => onDecide('rejected')}>
          {gate.rejectLabel || message(locale, 'consent_reject')}
        </Button>
        <Button disabled={busy} onclick={() => onDecide('accepted')}>
          {gate.acceptLabel || message(locale, 'consent_accept')}
        </Button>
      </div>
    {/if}
  </div>
</div>
