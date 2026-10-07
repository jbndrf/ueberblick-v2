<script lang="ts">
  // v3 `DateClause.svelte:65-84`: "Erstellt" or "Geändert", then older than N days, newer than N days or between two
  // days. The moments are the system metadata of every Objekt (WP-306: `$created_at`, `$changed_at`), not properties.
  import type { WhenClause } from '@ueberblick/core/filters';
  import { FILTER_WHEN_FIELDS, FILTER_WHEN_MODES } from '@ueberblick/core/registry/filter';
  import type { FilterWhenField, FilterWhenMode } from '@ueberblick/core/registry/filter';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { message, type Locale } from '../../../messages';
  import ClauseFrame from './ClauseFrame.svelte';

  interface Props {
    clause: WhenClause;
    locale: Locale;
    onchange: (next: WhenClause) => void;
    onremove: () => void;
  }
  let { clause, locale, onchange, onremove }: Props = $props();

  const fieldLabel = (f: FilterWhenField): string =>
    message(
      locale,
      f === 'created' ? 'filter_builder_date_field_created' : 'filter_builder_date_field_updated',
    );
  const modeLabel = (m: FilterWhenMode): string =>
    message(
      locale,
      m === 'older'
        ? 'filter_builder_op_older'
        : m === 'newer'
          ? 'filter_builder_op_newer'
          : 'filter_builder_op_between',
    );

  function setMode(mode: FilterWhenMode): void {
    onchange(
      mode === 'between'
        ? { ...clause, mode, from: null, to: null }
        : { ...clause, mode, days: clause.days > 0 ? clause.days : 7 },
    );
  }
  function setDays(raw: string): void {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) onchange({ ...clause, days: n });
  }
</script>

<ClauseFrame {locale} kind="when" caps title={message(locale, 'filter_builder_clause_date')} {onremove}>
  <div class="grid grid-cols-2 gap-2">
    <select
      class="h-8 rounded-md border bg-background px-2 text-sm"
      aria-label={message(locale, 'filter_builder_clause_date')}
      value={clause.field}
      onchange={(e) => onchange({ ...clause, field: e.currentTarget.value as FilterWhenField })}
    >
      {#each FILTER_WHEN_FIELDS.keys as f (f)}
        <option value={f}>{fieldLabel(f)}</option>
      {/each}
    </select>
    <select
      class="h-8 rounded-md border bg-background px-2 text-sm"
      aria-label={modeLabel(clause.mode)}
      value={clause.mode}
      onchange={(e) => setMode(e.currentTarget.value as FilterWhenMode)}
    >
      {#each FILTER_WHEN_MODES.keys as m (m)}
        <option value={m}>{modeLabel(m)}</option>
      {/each}
    </select>
  </div>

  {#if clause.mode === 'between'}
    <div class="grid grid-cols-2 gap-2">
      <Input
        type="date"
        class="h-8"
        aria-label={message(locale, 'filter_builder_date_from')}
        value={clause.from ?? ''}
        onchange={(e) => onchange({ ...clause, from: e.currentTarget.value || null })}
      />
      <Input
        type="date"
        class="h-8"
        aria-label={message(locale, 'filter_builder_date_to')}
        value={clause.to ?? ''}
        onchange={(e) => onchange({ ...clause, to: e.currentTarget.value || null })}
      />
    </div>
  {:else}
    <Input
      type="number"
      min="1"
      step="1"
      class="h-8"
      aria-label={modeLabel(clause.mode)}
      value={clause.days}
      onchange={(e) => setDays(e.currentTarget.value)}
    />
  {/if}
</ClauseFrame>
