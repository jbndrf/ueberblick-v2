<script lang="ts">
  // The relation level of the detail path (v3 RelationList.svelte): all children of one relation, finished ones greyed,
  // each with a dot in its colour, label, "stage · time" and a red dot when work waits for this participant; open work
  // first, then active, then finished. On top the labelled "{name} anlegen" button when creating is offered.
  import Plus from '@lucide/svelte/icons/plus';
  import type { FeatureId, Instant } from '@ueberblick/core/model';
  import { message, type Locale } from '../../messages';
  import { ago } from '../ago';
  import type { CreateOffer, RelationNav } from './nav';

  interface Props {
    nav: RelationNav;
    parent: FeatureId;
    group: string;
    locale: Locale;
    now: Instant;
    /** The offer to create a child here, when the participant may. */
    create: CreateOffer | undefined;
    /** Does this child lead to open work? Counted after the sheet is open, so `false` until then. */
    leads: (id: FeatureId) => boolean;
    oncreate: () => void;
    onopen: (id: FeatureId) => void;
  }
  let { nav, parent, group, locale, now, create, leads, oncreate, onopen }: Props = $props();

  const rows = $derived(
    nav
      .children(parent, group)
      .map((id) => ({
        summary: nav.summary(id),
        finished: nav.isFinished(id),
        openWork: leads(id),
      }))
      .flatMap((r) => (r.summary === undefined ? [] : [{ ...r, summary: r.summary }]))
      // Open work first, then active, then finished.
      .sort((a, b) => Number(b.openWork) - Number(a.openWork) || Number(a.finished) - Number(b.finished)),
  );
</script>

<div class="space-y-2" data-testid="relation-list">
  {#if create}
    <button
      type="button"
      class="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
      onclick={oncreate}
    >
      <Plus class="h-4 w-4" />
      {message(locale, 'relation_create_child', { name: create.name })}
    </button>
  {/if}

  {#if rows.length === 0}
    <p class="py-6 text-center text-sm text-muted-foreground">{message(locale, 'relation_empty')}</p>
  {:else}
    <ul class="space-y-1.5">
      {#each rows as row (row.summary.id)}
        {@const s = row.summary}
        <li>
          <button
            type="button"
            class="flex min-h-11 w-full items-center gap-2.5 rounded-lg border bg-background p-2.5 text-left transition-colors hover:bg-accent active:bg-accent/80"
            class:opacity-55={row.finished}
            data-testid="relation-row"
            data-finished={row.finished}
            onclick={() => onopen(s.id)}
          >
            <span class="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{s.label}</span>
              <span class="block truncate text-xs text-muted-foreground">
                {[s.stageName, s.updatedAt === undefined ? '' : ago(s.updatedAt, now, locale)]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {#if row.openWork}
              <span
                class="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600"
                role="img"
                aria-label={message(locale, 'relation_open_work_dot')}
              ></span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
