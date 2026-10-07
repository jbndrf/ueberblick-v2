<script lang="ts">
  // v3's Daten rows (ViewFieldsTool over the form renderer in view mode, `FieldRenderer.svelte` 523-641): per property an
  // uppercase label over a bordered value box, selections as badges in option order, long text kept, a placeholder for
  // an empty value, photos as the gallery, and the field history behind a count (`CmmnFieldChrome.svelte`). The count
  // reads "Messungen" or "Änderungen" by the property's `display.history` (v3: by write mode).
  import type { FeatureId } from '@ueberblick/core/model';
  import type { PropertyHistoryHint } from '@ueberblick/core/registry';
  import { MediaGallery, type HistoryRow, type PropertyRow } from '@ueberblick/ui';
  import { cn } from '@ueberblick/ui/utils';
  import { badgeVariants } from '@ueberblick/ui/components/ui/badge';
  import HistoryIcon from '@lucide/svelte/icons/history';
  import { message, type Locale } from '../../messages';
  import FieldHistoryDialog from './FieldHistoryDialog.svelte';
  import { COLUMN_CLASS } from '@ueberblick/ui';
  import type { DataCell } from './layout';
  import { HISTORY_MIN, historyByProperty } from './history';

  interface Props {
    lines: readonly (readonly DataCell[])[];
    history: readonly HistoryRow[];
    hints: Readonly<Record<string, PropertyHistoryHint>>;
    locale: Locale;
    onopen: (id: FeatureId) => void;
  }
  let { lines, history: historyRows, hints, locale, onopen }: Props = $props();
  const label = (id: string): string => message(locale, 'feature_open', { label: id });

  const history = $derived(historyByProperty(historyRows));
  let historyOf = $state<PropertyRow | undefined>(undefined);
  let historyOpen = $state(false);
  const historyEntries = $derived(historyOf === undefined ? [] : (history.get(historyOf.key) ?? []));

  // The badge's classes merged once, not per badge: `Badge` runs tailwind-merge on every render (R14).
  const badgeClass = cn(badgeVariants({ variant: 'secondary' }), 'text-left break-words whitespace-normal');
  const box = 'min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm break-words';
  const emptyBox =
    'rounded-md border border-input bg-muted/30 px-3 py-2 text-sm text-muted-foreground italic';
</script>

<div class="space-y-4">
  {#each lines as line, i (i)}
    <div class="flex flex-wrap gap-4">
      {#each line as { row, column } (row.key)}
        {@const count = history.get(row.key)?.length ?? 0}
        <dl
          class={`m-0 flex flex-col gap-1 ${COLUMN_CLASS[column]}`}
          data-testid="daten-property"
          data-field-id={row.key}
          data-column={column}
        >
          <dt class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{row.label}</dt>
          <dd class="m-0 flex flex-col gap-1">
            {#if row.links.length > 0}
              <div class={`${box} flex flex-wrap gap-x-3`}>
                {#each row.links as link (link.id)}
                  <button type="button" class="link" onclick={() => onopen(link.id)}>
                    <span class="sr-only">{label(link.label)}</span>
                    <span aria-hidden="true">{link.label}</span>
                  </button>
                {/each}
              </div>
            {:else if row.kind === 'file'}
              {#if row.files.length > 0}
                <div class={box}><MediaGallery files={row.files} mode="view" size="list" /></div>
              {:else}
                <div class={emptyBox}>{message(locale, 'feature_no_file')}</div>
              {/if}
            {:else if row.empty && (row.kind === 'select' || row.kind === 'multiselect')}
              <div class={emptyBox}>{row.text}</div>
            {:else if row.badges.length > 0}
              <div
                class="flex min-h-10 flex-wrap gap-1.5 rounded-md border border-input bg-background px-3 py-2"
              >
                {#each row.badges as badge, i (i)}
                  <span data-slot="badge" class={badgeClass}>{badge}</span>
                {/each}
              </div>
            {:else}
              <div class={`${box} ${row.multiline ? 'min-h-[100px] whitespace-pre-wrap' : ''}`}>
                {#if row.empty}
                  <span class="text-muted-foreground italic">{row.text}</span>
                {:else}
                  {row.text}
                {/if}
              </div>
            {/if}
            {#if count >= HISTORY_MIN}
              <button
                type="button"
                class="history-toggle"
                onclick={() => {
                  historyOf = row;
                  historyOpen = true;
                }}
              >
                <HistoryIcon class="size-3" />
                <span
                  >{message(
                    locale,
                    hints[row.key] === 'measurements'
                      ? 'feature_history_measurements'
                      : 'feature_history_changes',
                    { count },
                  )}</span
                >
              </button>
            {/if}
          </dd>
        </dl>
      {/each}
    </div>
  {/each}
</div>

{#if historyOf !== undefined}
  <FieldHistoryDialog bind:open={historyOpen} label={historyOf.label} entries={historyEntries} {locale} />
{/if}

<style>
  .link {
    min-height: 44px;
    min-width: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--primary);
    font: inherit;
    text-decoration: underline;
    text-align: start;
    cursor: pointer;
  }
  /* v3 `.history-toggle` (CmmnFieldChrome): a small muted chip; the tap area is widened to 44px without changing its look. */
  .history-toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    align-self: flex-start;
    margin-top: 0.375rem;
    padding: 0.25rem 0.5rem;
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--foreground);
    background: var(--muted);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    cursor: pointer;
    transition: background 0.1s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .history-toggle {
      transition: none;
    }
  }
  .history-toggle::after {
    content: '';
    position: absolute;
    inset: -0.5rem;
  }
  .history-toggle:hover {
    background: var(--accent);
    color: var(--foreground);
  }
</style>
