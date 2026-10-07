<script lang="ts">
  // v3 `StageClause.svelte`: pick the Objektart (v3: workflow), then check the stages that pass. The stage is the
  // property of the Objektart's process (R4: nothing built in), written as a choice on that property.
  import type { BuilderContext, StageClause } from '@ueberblick/core/filters';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import { message, type Locale } from '../../../messages';
  import ClauseFrame from './ClauseFrame.svelte';

  interface Props {
    clause: StageClause;
    ctx: BuilderContext;
    locale: Locale;
    onchange: (next: StageClause) => void;
    onremove: () => void;
  }
  let { clause, ctx, locale, onchange, onremove }: Props = $props();

  const stages = $derived(ctx.stages.find((s) => s.type === clause.type)?.stages ?? []);

  function toggle(value: string, on: boolean): void {
    const next = new Set(clause.values);
    if (on) next.add(value);
    else next.delete(value);
    onchange({ ...clause, values: [...next] });
  }
</script>

<ClauseFrame {locale} kind="stage" caps title={message(locale, 'filter_builder_clause_stage')} {onremove}>
  <select
    class="h-8 w-full rounded-md border bg-background px-2 text-sm"
    aria-label={message(locale, 'filter_builder_pick_type')}
    value={clause.type}
    onchange={(e) => onchange({ ...clause, type: e.currentTarget.value, values: [] })}
  >
    <option value="" disabled>{message(locale, 'filter_builder_pick_type')}</option>
    {#each ctx.stages as s (s.type)}
      <option value={s.type}>{s.typeLabel}</option>
    {/each}
  </select>

  {#if stages.length > 0}
    <div class="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
      {#each stages as stage (stage.value)}
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={clause.values.includes(stage.value)}
            onCheckedChange={(next) => toggle(stage.value, next === true)}
          />
          <span class="truncate">{stage.label}</span>
        </label>
      {/each}
    </div>
  {:else}
    <p class="text-xs text-muted-foreground">{message(locale, 'filter_builder_no_stages')}</p>
  {/if}
</ClauseFrame>
