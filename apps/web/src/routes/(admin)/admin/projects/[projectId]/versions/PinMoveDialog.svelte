<script lang="ts">
  // "Auf aktuelle Version verschieben" (owner P3, QUESTIONS "Owner answers 2026-10-02"; v3 had no such button). The
  // dialog opens from a Versionen row with pinned Objekte and is the deploy overview's mapping part (R1): per Objektart
  // `DeployGroup` asks "verschieben nach [Phase]" or "Werte verwerfen" for every breaking difference that touches the
  // pinned Objekte, with their counts. Counts and rows come from the engine's dry run (`calls.movePlan`); confirming sends
  // the answers (`calls.movePins`), which unpins and moves through runs, all or nothing.
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import type { ValueMapping } from '@ueberblick/server';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import DeployGroup from '../../../../../../lib/admin/deploy/DeployGroup.svelte';
  import {
    mappingsToSend,
    missingPicks,
    type Picks,
  } from '../../../../../../lib/admin/deploy/overview-model';
  import type { PinMoveView } from '../../../../../../lib/admin/deploy/pin-move-view';
  import { adminMessage } from '../../../shell/messages';
  import type { Locale } from '../../../shell/locale';
  import type { VersionsCalls } from './types';

  interface Props {
    locale: Locale;
    /** The old version whose pinned Objekte move; `null` while the dialog is closed. */
    version: number | null;
    calls: VersionsCalls;
    onclose: () => void;
    /** The move went through: the page reads its list again. */
    onmoved: () => void;
  }
  let { locale, version, calls, onclose, onmoved }: Props = $props();
  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  let view = $state<PinMoveView | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let picks = $state<Picks>({});
  let moving = $state(false);
  let seq = 0;

  const text = (reason: string, fallback: Parameters<typeof adminMessage>[1]): string =>
    reason === 'failed' ? t(fallback) : reason;

  // Opening reads a fresh dry run and starts without answers: what was true when the admin last looked may be stale.
  $effect(() => {
    const v = version;
    if (v === null) return;
    const mine = ++seq;
    view = null;
    picks = {};
    error = null;
    loading = true;
    void calls.movePlan(v, locale).then((a) => {
      if (mine !== seq) return;
      loading = false;
      if (a.ok) view = a.view;
      else error = text(a.reason, 'deploy_load_failed');
    });
  });

  const missing = $derived(view === null ? [] : missingPicks(view.plan, {}, picks));

  function pick(path: string, mapping: ValueMapping | undefined): void {
    picks = { ...picks, [path]: mapping };
  }

  async function confirm(): Promise<void> {
    if (view === null || version === null || missing.length > 0 || moving) return;
    moving = true;
    error = null;
    const a = await calls.movePins(version, mappingsToSend(view.plan, {}, picks), locale);
    moving = false;
    if (a.ok) {
      toast.success(t('versions_move_done', { count: a.unpinned, to: a.to }));
      onmoved();
      onclose();
    } else error = text(a.reason, 'versions_move_failed');
  }
</script>

<Dialog.Root open={version !== null} onOpenChange={(o) => !o && onclose()}>
  <Dialog.Content
    class="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 sm:max-w-2xl"
    data-testid="pin-move"
    aria-describedby="pin-move-hint"
  >
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <ArrowRightLeft class="size-5 text-amber-700 dark:text-amber-300" />
        {t('versions_move_title', { from: version ?? 0, to: view?.to ?? 0 })}
      </Dialog.Title>
      <Dialog.Description id="pin-move-hint">{t('versions_move_hint')}</Dialog.Description>
    </Dialog.Header>

    <div class="min-h-0 flex-1 overflow-y-auto" data-testid="pin-move-body">
      {#if loading}
        <p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 class="size-4 animate-spin" />
          {t('deploy_loading')}
        </p>
      {:else if view !== null}
        <p class="mb-3 text-sm" data-testid="pin-move-summary">
          {t('versions_move_summary', { count: view.pinned, from: view.from, to: view.to })}
        </p>
        <ul class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {#each view.types as ty (ty.type)}
            <li>{ty.label}: {t('deploy_objects', { count: ty.count })}</li>
          {/each}
        </ul>
        {#if view.plan.groups.length === 0}
          <p class="text-sm text-muted-foreground">{t('versions_move_nothing')}</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each view.plan.groups as group (group.type ?? '$project')}
              <DeployGroup
                {locale}
                {group}
                plan={view.plan}
                choices={{}}
                {picks}
                onchoice={() => undefined}
                onpick={pick}
              />
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    {#if missing.length > 0}
      <p class="text-sm text-destructive" role="status">{t('deploy_needs_pick')}</p>
    {/if}
    {#if error !== null}
      <p class="text-sm text-destructive" role="alert">{error}</p>
    {/if}

    <Dialog.Footer class="gap-2">
      <Button variant="outline" class="min-h-11 sm:min-h-9" disabled={moving} onclick={onclose}>
        {t('versions_cancel')}
      </Button>
      <Button
        class="min-h-11 sm:min-h-9"
        disabled={view === null || missing.length > 0 || moving}
        onclick={() => void confirm()}
      >
        {#if moving}
          <Loader2 class="mr-1.5 size-4 animate-spin" />
        {:else}
          <ArrowRightLeft class="mr-1.5 size-4" />
        {/if}
        {t('versions_move_confirm')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
