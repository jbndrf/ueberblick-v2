<script lang="ts">
  // The Protokoll of one past run (owner answer A3; v3's Protokolle tab, `instances/[id]/+page.svelte:325,462`, listed
  // signed-off snapshots): that run's task form, filled and read-only, "Protokoll vom <Datum>, <Autor>". It is lead-b's
  // form renderer in its `readonly` mode, over the form of the run's own config version; the server sent only the
  // fields the viewer may read, so nothing is filtered here. "Als PDF exportieren" is the browser's print.
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import Printer from '@lucide/svelte/icons/printer';
  import { shortId } from '@ueberblick/core';
  import {
    buildFormModel,
    FormRenderer,
    localize,
    providePhotoUrl,
    type Json,
    type ToolSlot,
  } from '@ueberblick/ui';
  import type { Protokoll } from '@ueberblick/server';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import { actorName } from '../actor-names';
  import { serverPhotoUrl } from '../../shared/photo-url';
  import { PROTOKOLL_PRINT_CSS } from './protokoll-print';
  import { protokollSession } from './protokoll-session';

  let {
    locale,
    project,
    protokoll,
    names,
    backHref,
  }: {
    locale: 'de' | 'en';
    project: string;
    protokoll: Protokoll;
    names: Readonly<Record<string, string>>;
    backHref: string;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  const actors = {
    system: t('data_actor_system'),
    importBy: (admin: string) => t('data_actor_import', { admin }),
  };

  providePhotoUrl(serverPhotoUrl(project));

  const author = $derived(
    actorName(names, protokoll.run.actor.id, actors) !== protokoll.run.actor.id
      ? actorName(names, protokoll.run.actor.id, actors)
      : (protokoll.run.actor.name ?? protokoll.run.actor.id),
  );
  const date = $derived.by(() => {
    const d = new Date(protokoll.run.receivedAt);
    return Number.isNaN(d.getTime()) ? protokoll.run.receivedAt : d.toLocaleString(locale);
  });
  const taskLabel = $derived(
    protokoll.run.taskLabel === null
      ? protokoll.run.task
      : localize(protokoll.run.taskLabel, locale) || protokoll.run.task,
  );
  const model = $derived(buildFormModel({ form: protokoll.form, properties: protokoll.properties }));
  const session = $derived(protokollSession(model, protokoll.values, locale));
  // Participant fields show the roster's names. A reference shows the referenced feature's name (the server resolved
  // it: `protokoll.labels`), else core `shortId`, never the stored id (WP-1076).
  const idsOf = (v: Json | undefined): string[] =>
    typeof v === 'string' && v !== '' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  const choices = $derived(
    Object.fromEntries(
      model.fields
        .filter((f) => f.input === 'choice')
        .map((f) => [
          f.key,
          f.type === 'reference'
            ? idsOf(protokoll.values[f.key] as Json | undefined).map((value) => ({
                value,
                label: protokoll.labels[value] ?? shortId(value),
              }))
            : Object.entries(names).map(([value, label]) => ({ value, label })),
        ]),
    ),
  );

  const shape = (v: Json | undefined): string => {
    const g = v as { type?: string; coordinates?: [number, number] } | null | undefined;
    return g?.type === 'Point' && Array.isArray(g.coordinates)
      ? t('feature_protokoll_geometry_point', {
          lat: g.coordinates[1].toFixed(5),
          lon: g.coordinates[0].toFixed(5),
        })
      : t('feature_protokoll_geometry_shape');
  };
</script>

<svelte:head>{@html `<style>${PROTOKOLL_PRINT_CSS}</style>`}</svelte:head>

{#snippet tool(slot: ToolSlot)}
  {#if slot.field.type === 'geometry' && slot.value !== undefined && slot.value !== null}
    <p class="text-sm" data-testid="protokoll-geometry">{shape(slot.value)}</p>
  {/if}
{/snippet}

<div class="protokoll-page mx-auto max-w-4xl space-y-6" data-testid="protokoll">
  <div class="space-y-3">
    <a
      href={backHref}
      class="protokoll-noprint inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      data-testid="protokoll-back"
    >
      <ChevronLeft class="h-4 w-4" aria-hidden="true" />
      {t('feature_protokoll_back')}
    </a>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-2xl font-bold break-words" data-testid="protokoll-title">
          {t('feature_protokoll_title', { date, author })}
        </h1>
        <p class="text-sm text-muted-foreground" data-testid="protokoll-task">{taskLabel}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        class="protokoll-noprint"
        data-testid="protokoll-print"
        onclick={() => window.print()}
      >
        <Printer class="mr-2 h-4 w-4" aria-hidden="true" />
        {t('feature_protokoll_print')}
      </Button>
    </div>
  </div>

  <div class="rounded-lg border border-border" data-testid="protokoll-form">
    <FormRenderer {session} readonly {choices} {tool} onsubmit={() => undefined} />
  </div>
</div>
