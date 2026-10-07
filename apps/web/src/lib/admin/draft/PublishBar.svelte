<script lang="ts">
  // The bar "Unveröffentlichte Änderungen" with one "Veröffentlichen" (owner Q13/Q16/Q17). Its look is v3's status
  // box (`settings/sections/LifecycleSection.svelte:69-158`: amber box, title, hint, blockers with a warning icon,
  // "Live schalten" with a rocket). It is engine-required: every setup change goes through the draft, and nothing is
  // live before the first publish. "Veröffentlichen" opens the deploy overview (S4-18, `../deploy/`), which shows
  // what changes, asks for the value moves and the choice for running Objekte, and deploys.
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Rocket from '@lucide/svelte/icons/rocket';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { deployOverview } from '../deploy/overview-store.svelte';
  import { builderHref, type DraftStatusView } from './publish-client';

  let {
    locale,
    project,
    status,
  }: {
    locale: Locale;
    project: string;
    status: DraftStatusView | null;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1], values: Record<string, string | number> = {}): string =>
    adminMessage(locale, key, values);

  const never = $derived(status?.neverPublished === true);
  const visible = $derived(status !== null && (status.dirty || status.neverPublished));
  const problems = $derived(status?.problems ?? 0);

  // The "Version n ist live" line goes away by itself.
  $effect(() => {
    if (deployOverview.published === null) return;
    const timer = setTimeout(() => (deployOverview.published = null), 6000);
    return () => clearTimeout(timer);
  });
</script>

{#if deployOverview.published !== null}
  <div
    role="status"
    class="flex items-center gap-2 border-b border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
  >
    <CircleCheck class="size-4 shrink-0" />
    {t('draft_published', { version: deployOverview.published })}
  </div>
{/if}
{#if visible && status}
  <div
    data-testid="publish-bar"
    class="flex flex-col gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-amber-800 dark:bg-amber-950/30"
  >
    <div class="min-w-0">
      <span class="font-medium text-amber-800 dark:text-amber-300"
        >{t(never ? 'draft_bar_never_title' : 'draft_bar_unpublished_title')}</span
      >
      <p class="text-xs text-amber-800/80 dark:text-amber-300/80">
        {t(never ? 'draft_bar_never_hint' : 'draft_bar_unpublished_hint')}
      </p>
      {#if problems > 0}
        <p class="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-destructive">
          <TriangleAlert class="size-3 shrink-0" />
          <span
            >{problems === 1 ? t('draft_problems_one') : t('draft_problems_other', { count: problems })}</span
          >
          <a class="underline" href={builderHref(project, status.type)}>{t('draft_open_builder')}</a>
        </p>
      {/if}
    </div>
    <Button class="w-full shrink-0 sm:w-auto" onclick={() => deployOverview.show()}>
      <Rocket class="mr-1.5 size-4" />
      {t('draft_publish')}
    </Button>
  </div>
{/if}
