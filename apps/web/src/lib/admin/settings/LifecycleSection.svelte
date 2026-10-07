<script lang="ts">
  // v3 `settings/sections/LifecycleSection.svelte:62-160` ("Status & Freigabe"): a status box (amber while a draft, plain
  // when live), the list of Objektarten with their number of objects and their blockers (a red warning line each), the
  // hint to fix the blockers first, "Live schalten" with a rocket and an AlertDialog confirm. v4 has one release step,
  // the publish bar's deploy: the box also says when the draft differs from the live version, and the button then reads
  // "Veröffentlichen". v3's fork has no counterpart (every change goes through the draft), so its hint is replaced.
  // Below the status sits v3's "Vorschau-Logins" card (`fork/+page.svelte:297-312`, on the page "Entwurf — Vorschau & Release"):
  // the same component as in the deploy overview (R1), usable before any publish (owner 2026-10-05).
  // The button opens the deploy overview (WP-360), the same one the publish bar opens, in place of v3's AlertDialog confirm.
  import Rocket from '@lucide/svelte/icons/rocket';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import ProjectCompare from '../deploy/ProjectCompare.svelte';
  import { createDeployClient } from '../deploy/deploy-client';
  import { deployOverview } from '../deploy/overview-store.svelte';
  import PreviewLogins from '../preview/PreviewLogins.svelte';
  import { builderHref } from '../draft/publish-client';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';

  let { data, locale, project, reload }: SectionProps = $props();
  const t = (key: AdminKey, values: Record<string, string | number> = {}): string =>
    adminMessage(locale, key, values);

  const client = $derived(createDeployClient({ project, fetch }));
  const l = $derived(data.lifecycle);
  const nothingToDo = $derived(!l.neverPublished && !l.dirty);
  const hasRows = $derived(l.types.length > 0 || l.other.length > 0);

  // A deploy from the overview made a new version: read the page's state again (the box says "Live").
  let seen = deployOverview.published;
  $effect(() => {
    const now = deployOverview.published;
    if (now === seen) return;
    seen = now;
    if (now !== null) void reload();
  });
</script>

<SettingsSection name={t('life_title')} description={t('life_description')}>
  <div class="flex flex-col gap-4">
    {#if nothingToDo}
      <div class="rounded-md border p-4 text-sm" data-testid="life-status" data-state="live">
        <span class="font-medium">{t('life_status_live', { version: l.version ?? 0 })}</span>
        <p class="mt-1 text-xs text-muted-foreground">{t('life_live_hint')}</p>
        <a class="mt-2 inline-block text-xs underline" href={`/admin/projects/${project}/versions`}>
          {t('life_versions_link')}
        </a>
      </div>
    {:else}
      <div
        class="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/30"
        data-testid="life-status"
        data-state={l.neverPublished ? 'draft' : 'changed'}
      >
        <span class="font-medium text-amber-800 dark:text-amber-300">
          {l.neverPublished ? t('life_status_draft') : t('life_status_changed', { version: l.version ?? 0 })}
        </span>
        <p class="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
          {l.neverPublished ? t('life_draft_hint') : t('life_changed_hint')}
        </p>
      </div>
    {/if}

    {#if hasRows}
      <div class="flex flex-col gap-2 rounded-md border p-4" data-testid="life-types">
        {#each l.types as type (type.key)}
          <div class="flex flex-col gap-1 text-sm">
            <div class="flex items-center justify-between gap-4">
              <span class="min-w-0 truncate font-medium">{type.label}</span>
              <span class="shrink-0 text-xs text-muted-foreground"
                >{t('life_objects', { count: type.objects })}</span
              >
            </div>
            {#if type.blockers.length > 0}
              <ul class="flex flex-col gap-0.5">
                {#each type.blockers as blocker, i (i)}
                  <li class="flex items-start gap-1.5 text-xs text-destructive">
                    <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{blocker}</span>
                    <a class="underline" href={builderHref(project, type.key)}>{t('draft_open_builder')}</a>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
        {#if l.other.length > 0}
          <div class="flex flex-col gap-1 text-sm">
            <span class="font-medium">{t('life_other')}</span>
            <ul class="flex flex-col gap-0.5">
              {#each l.other as blocker, i (i)}
                <li class="flex items-start gap-1.5 text-xs text-destructive">
                  <TriangleAlert class="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{blocker}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if l.blockerCount > 0}
          <p class="mt-1 text-xs text-muted-foreground">{t('life_blockers_hint')}</p>
        {/if}
      </div>
    {/if}

    <PreviewLogins {locale} {client} />

    {#if !nothingToDo}
      <div>
        <Button disabled={l.blockerCount > 0} onclick={() => deployOverview.show()}>
          <Rocket class="mr-1.5 h-4 w-4" />
          {l.neverPublished ? t('life_go_live') : t('draft_publish')}
        </Button>
      </div>
    {/if}

    <ProjectCompare {locale} {client} />
  </div>
</SettingsSection>
