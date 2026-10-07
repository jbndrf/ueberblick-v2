<script lang="ts">
  // v3 `CreatedByClause.svelte`: check the people whose Objekte pass. v3 listed raw ids (an "unresolved id" badge);
  // here the person is shown by name (owner decision, WP-306 `createdBy`), "Jemand" when the device has no name.
  import type { CreatedByClause } from '@ueberblick/core/filters';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import { message, type Locale } from '../../../messages';
  import ClauseFrame from './ClauseFrame.svelte';
  import type { CreatorOption } from './port';

  interface Props {
    clause: CreatedByClause;
    creators: readonly CreatorOption[];
    locale: Locale;
    onchange: (next: CreatedByClause) => void;
    onremove: () => void;
  }
  let { clause, creators, locale, onchange, onremove }: Props = $props();

  function toggle(id: string, on: boolean): void {
    const next = new Set(clause.values);
    if (on) next.add(id);
    else next.delete(id);
    onchange({ ...clause, values: [...next] });
  }
</script>

<ClauseFrame
  {locale}
  kind="created_by"
  caps
  title={message(locale, 'filter_builder_clause_created_by')}
  {onremove}
>
  {#if creators.length === 0}
    <p class="text-xs text-muted-foreground">{message(locale, 'filter_builder_no_creators')}</p>
  {:else}
    <div class="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
      {#each creators as c (c.id)}
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={clause.values.includes(c.id)}
            onCheckedChange={(next) => toggle(c.id, next === true)}
          />
          <span class="truncate">{c.label}</span>
        </label>
      {/each}
    </div>
  {/if}
</ClauseFrame>
