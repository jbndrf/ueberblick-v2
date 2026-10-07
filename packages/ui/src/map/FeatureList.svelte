<script lang="ts">
  import type { Json } from '@ueberblick/core/model';
  import { NAME_SORT, type FeatureListProps, type ListColumn } from './contract';
  import { sortFeatures } from './list';
  import { BATCH, more, nearEnd } from './feature-list/incremental';

  let { features, columns, labels, sort = [], onFeatureTap }: FeatureListProps = $props();

  // The user's choice overrides the view's initial sort; a second press flips the direction.
  let chosen = $state<string | undefined>(undefined);
  const order = $derived(chosen === undefined ? sort : [chosen]);
  const rows = $derived(sortFeatures(features, order));

  // Only the first rows are drawn; the next batch follows as the person scrolls near the end or focus reaches the last
  // drawn row (WP-862). The sort and the counts always cover every row.
  let count = $state(BATCH);
  const shown = $derived(Math.min(count, rows.length));
  const visibleRows = $derived(rows.length === shown ? rows : rows.slice(0, shown));
  const grow = (): void => {
    count = more(shown, rows.length);
  };

  function direction(key: string): 'ascending' | 'descending' | 'none' {
    const first = order[0];
    if (first === key) return 'ascending';
    if (first === `-${key}`) return 'descending';
    return 'none';
  }

  function toggle(key: string): void {
    chosen = direction(key) === 'ascending' ? `-${key}` : key;
    count = BATCH;
  }

  function text(col: ListColumn, value: Json | undefined): string {
    if (col.format !== undefined) return col.format(value);
    return value === undefined || value === null ? '' : String(value);
  }
</script>

<!-- A table wider than the screen scrolls here, never the page (WCAG 1.4.10); keyboard users reach it by focus. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="ub-scroll" role="region" aria-label={labels.caption} tabindex="0">
  <table class="ub-list" aria-rowcount={rows.length + 1}>
    <caption>{labels.caption}</caption>
    <thead>
      <tr>
        {#each [{ key: NAME_SORT, label: labels.name }, ...columns] as col (col.key)}
          <th scope="col" aria-sort={direction(col.key)}>
            <button type="button" class="ub-sort" onclick={() => toggle(col.key)}>
              {col.label}
              {#if direction(col.key) === 'ascending'}<span aria-label={labels.sortedAscending}>▲</span>{/if}
              {#if direction(col.key) === 'descending'}<span aria-label={labels.sortedDescending}>▼</span
                >{/if}
            </button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody
      onfocusin={(e) => {
        if (
          shown < rows.length &&
          (e.target as HTMLElement).closest('tr') === e.currentTarget.lastElementChild
        )
          grow();
      }}
    >
      {#each visibleRows as feature, i (feature.id)}
        <tr
          class="ub-row"
          data-feature-id={feature.id}
          aria-rowindex={i + 2}
          onclick={() => onFeatureTap(feature.id)}
        >
          <td>
            <button
              type="button"
              class="ub-open"
              onclick={(e) => {
                e.stopPropagation();
                onFeatureTap(feature.id);
              }}
            >
              {feature.name}
            </button>
          </td>
          {#each columns as col (col.key)}
            <td>{text(col, feature.properties[col.key])}</td>
          {/each}
        </tr>
      {:else}
        <tr><td colspan={columns.length + 1}>{labels.empty}</td></tr>
      {/each}
    </tbody>
  </table>
  {#if shown < rows.length}
    {#key shown}<div use:nearEnd={grow} aria-hidden="true"></div>{/key}
  {/if}
</div>

<style>
  .ub-list {
    width: 100%;
    border-collapse: collapse;
    color: var(--ub-color-text);
    background: var(--ub-color-surface);
  }
  caption {
    text-align: start;
    padding: var(--ub-space-sm);
    font-weight: 600;
  }
  th,
  td {
    text-align: start;
    padding: var(--ub-space-sm);
    border-bottom: 1px solid var(--ub-color-border);
  }
  .ub-scroll {
    overflow-x: auto;
    max-width: 100%;
  }
  .ub-scroll:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: -3px;
  }
  td {
    /* words and dates stay whole; only a token longer than its column (a feature id) breaks */
    overflow-wrap: break-word;
  }
  th {
    /* a header wraps between words; a word is never split ("Baumar / t") */
    overflow-wrap: normal;
  }
  .ub-sort,
  .ub-open {
    min-height: 44px;
    min-width: 44px;
    background: none;
    border: 0;
    font: inherit;
    color: inherit;
    text-align: start;
    cursor: pointer;
    max-width: 100%;
  }
  .ub-open {
    overflow-wrap: break-word;
  }
  .ub-sort:focus-visible,
  .ub-open:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: 2px;
  }
  .ub-row {
    cursor: pointer;
  }
</style>
