<script lang="ts">
  // The deploy overview (S4-18, v3 `fork/+page.svelte:160-331`, the "Release" card): what Veröffentlichen would change
  // per Objektart, what becomes of running Objekte and of values a removal leaves behind, what blocks it, and the
  // confirm. v3 had it as a page of the fork; v4 has no fork (owner decision 18), so it is a dialog that opens from
  // "Veröffentlichen" in the publish bar and in the builder toolbar (`deployOverview.show()`, one component for both).
  // Counts and diffs come from the engine's dry run (`GET .../plan`); this file only shows them and sends the picks.
  // Below the changes sits v3's second card of that page, the "Vorschau-Logins" (WP-373, `PreviewLogins.svelte`).
  import { untrack } from 'svelte';
  import Loader2 from '@lucide/svelte/icons/loader-2';
  import Rocket from '@lucide/svelte/icons/rocket';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { ValueMapping } from '@ueberblick/server';
  import type { VersionDeployChoice } from '@ueberblick/core';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { DeployClient } from './deploy-client';
  import PreviewLogins from '../preview/PreviewLogins.svelte';
  import DeployGroup from './DeployGroup.svelte';
  import ProjectCompare from './ProjectCompare.svelte';
  import { choicesToSend, holdOf, missingPicks, requestOf, type Choices, type Picks } from './overview-model';
  import { deployOverview } from './overview-store.svelte';
  import type { Blocker, DeployPlan } from './types';

  interface Props {
    locale: Locale;
    client: DeployClient;
    /** "Gehe zu": the host opens the builder at the element (register a3 row 97). */
    ongoto: (blocker: Blocker) => void;
    /** The deploy went through: the shell reads the draft status again. */
    onpublished: (version: number) => void;
  }
  let { locale, client, ongoto, onpublished }: Props = $props();
  const t = (key: Parameters<typeof adminMessage>[1], values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  let plan = $state<DeployPlan | null>(null);
  let loading = $state(false);
  let choices = $state<Choices>({});
  let picks = $state<Picks>({});
  let publishing = $state(false);
  let notice = $state<string | null>(null);
  let seq = 0;

  /** Reads the dry run with the current choices; an older answer never overwrites a newer one. */
  async function load(): Promise<void> {
    const mine = ++seq;
    loading = plan === null;
    const next = await client.plan(plan === null ? {} : choicesToSend(plan, choices), locale);
    if (mine !== seq) return;
    loading = false;
    if (next !== null) plan = next;
  }

  // Opening starts from a fresh plan and no picks (what was true when the admin last looked may be stale).
  $effect(() => {
    if (!deployOverview.open) return;
    untrack(() => {
      plan = null;
      choices = {};
      picks = {};
      notice = null;
      void load();
    });
  });

  function choose(type: string, choice: VersionDeployChoice): void {
    choices = { ...choices, [type]: choice };
    void load(); // the counts of the choice come from the engine, never from here
  }
  function pick(path: string, mapping: ValueMapping | undefined): void {
    picks = { ...picks, [path]: mapping };
  }

  const hold = $derived(holdOf(plan, choices, picks));
  const first = $derived(plan?.first === true);

  async function confirm(): Promise<void> {
    if (plan === null || hold !== null || publishing) return;
    const request = requestOf(plan, choices, picks);
    if (request === null) return;
    publishing = true;
    notice = null;
    const answer = await client.deploy(request);
    publishing = false;
    if (answer.kind === 'deployed') {
      deployOverview.open = false;
      deployOverview.published = answer.version;
      toast.success(t('draft_published', { version: answer.version }));
      onpublished(answer.version);
      return;
    }
    notice =
      answer.kind === 'stale'
        ? t('deploy_stale')
        : answer.kind === 'mapping_required'
          ? t('deploy_mapping_required')
          : answer.kind === 'problems'
            ? t('deploy_blockers_hint')
            : t('deploy_failed');
    if (answer.kind !== 'failed') {
      plan = null;
      void load();
    }
  }

  function go(b: Blocker): void {
    deployOverview.open = false;
    ongoto(b);
  }
</script>

<Dialog.Root bind:open={deployOverview.open}>
  <Dialog.Content
    class="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 sm:max-w-2xl"
    data-testid="deploy-overview"
    aria-describedby="deploy-hint"
  >
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <Rocket class="size-5 text-amber-700 dark:text-amber-300" />
        {t(first ? 'deploy_title_first' : 'deploy_title')}
      </Dialog.Title>
      <Dialog.Description id="deploy-hint"
        >{t(first ? 'deploy_hint_first' : 'deploy_hint')}</Dialog.Description
      >
    </Dialog.Header>

    <div class="min-h-0 flex-1 overflow-y-auto" data-testid="deploy-body">
      {#if loading}
        <p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 class="size-4 animate-spin" />
          {t('deploy_loading')}
        </p>
      {:else if plan === null}
        <p class="text-sm text-destructive" role="alert">{t('deploy_load_failed')}</p>
      {:else}
        {#if plan.blockers.length > 0}
          <section
            class="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
            aria-labelledby="deploy-blockers"
            data-testid="deploy-blockers"
          >
            <h3 id="deploy-blockers" class="mb-1 flex items-center gap-1.5 font-semibold text-destructive">
              <TriangleAlert class="size-4" />
              {t('deploy_blockers_title')}
            </h3>
            <ul class="flex flex-col gap-1">
              {#each plan.blockers as b (b.id)}
                <li class="flex flex-wrap items-center gap-x-2">
                  <span class="min-w-0 flex-1 text-destructive">{b.message}</span>
                  <Button
                    variant="link"
                    size="sm"
                    class="h-auto min-h-11 px-1 sm:min-h-0"
                    onclick={() => go(b)}
                  >
                    {t('deploy_blocker_go')}
                  </Button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if plan.groups.length === 0 && !first}
          <p class="text-sm text-muted-foreground">{t('deploy_no_changes')}</p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each plan.groups as group (group.type ?? '$project')}
              <DeployGroup {locale} {group} {plan} {choices} {picks} onchoice={choose} onpick={pick} />
            {/each}
          </ul>
        {/if}

        {#if plan.warnings.length > 0}
          <section class="mt-3 text-xs text-muted-foreground" aria-label={t('deploy_warnings_title')}>
            <h3 class="mb-1 font-semibold">{t('deploy_warnings_title')}</h3>
            <ul class="flex flex-col gap-1">
              {#each plan.warnings as w (w.path + w.code)}
                <li>{w.message}</li>
              {/each}
            </ul>
          </section>
        {/if}

        <div class="mt-3"><ProjectCompare {locale} {client} /></div>

        <PreviewLogins {locale} {client} />
      {/if}
    </div>

    {#if hold === 'needs_pick' && plan !== null && missingPicks(plan, choices, picks).length > 0}
      <p class="text-sm text-destructive" role="status">{t('deploy_needs_pick')}</p>
    {/if}
    {#if notice !== null}
      <p class="text-sm text-destructive" role="alert">{notice}</p>
    {/if}

    <Dialog.Footer class="gap-2">
      <Button
        variant="outline"
        class="min-h-11 sm:min-h-9"
        disabled={publishing}
        onclick={() => (deployOverview.open = false)}
      >
        {t('deploy_cancel')}
      </Button>
      <Button
        class="min-h-11 sm:min-h-9"
        disabled={hold !== null || publishing}
        onclick={() => void confirm()}
      >
        {#if publishing}
          <Loader2 class="mr-1.5 size-4 animate-spin" />
          {t('deploy_publishing')}
        {:else}
          <Rocket class="mr-1.5 size-4" />
          {t('deploy_confirm')}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
