<script lang="ts">
  // v3's FilterBuilder (`view-builder/FilterBuilder.svelte`, 234 lines): "Felder filtern" (a field picker, one row per
  // picked field), then the other rows (Stufe, Erstellungsdatum, Änderungsdatum, Erstellt von) and "Weitere
  // Bedingung hinzufügen". The rows are core's `Clause`; core writes them as rule-language source (R5). The OR-group
  // tree of v3 (`GroupNode`, `tree.ts`) was dead code and is not ported.
  import type { Clause } from '@ueberblick/core/filters';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { MultiSelect } from '@ueberblick/ui/components/ui/multi-select';
  import Plus from '@lucide/svelte/icons/plus';
  import { message, type Locale, type MessageKey } from '../../../messages';
  import {
    fieldId,
    otherClause,
    otherKinds,
    pickedIds,
    pickFields,
    removeAt,
    replaceAt,
    type OtherKind,
  } from './builder-state';
  import CreatedByRow from './CreatedByRow.svelte';
  import FieldRow from './FieldRow.svelte';
  import RuleRow from './RuleRow.svelte';
  import StageRow from './StageRow.svelte';
  import WhenRow from './WhenRow.svelte';
  import type { BuilderPort } from './port';

  interface Props {
    port: BuilderPort;
    clauses: readonly Clause[];
    locale: Locale;
    onchange: (next: readonly Clause[]) => void;
  }
  let { port, clauses, locale, onchange }: Props = $props();

  const ctx = $derived(port.context);
  const options = $derived(
    ctx.fields.map((f) => ({ value: fieldId(f), label: f.label, description: f.typeLabel })),
  );
  const typeLabel = (type: string): string | undefined =>
    ctx.stages.find((s) => s.type === type)?.typeLabel ?? ctx.fields.find((f) => f.type === type)?.typeLabel;

  let menuOpen = $state(false);
  const OTHER_LABEL: Readonly<Record<OtherKind, MessageKey>> = {
    stage: 'filter_builder_clause_stage',
    created: 'filter_builder_clause_created',
    changed: 'filter_builder_clause_updated',
    created_by: 'filter_builder_clause_created_by',
  };

  function addOther(kind: OtherKind): void {
    menuOpen = false;
    const fresh = otherClause(kind, ctx);
    if (fresh !== undefined) onchange([...clauses, fresh]);
  }
  const hasFieldRows = $derived(clauses.some((c) => c.kind === 'field'));
  // The creators are read (one pass over the device) only once a "Erstellt von" row exists.
  const creators = $derived(clauses.some((c) => c.kind === 'created_by') ? port.creators() : []);
</script>

<div class="space-y-4" data-builder>
  <div>
    <span class="mb-1 block text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {message(locale, 'filter_builder_fields_label')}
    </span>
    <MultiSelect
      {options}
      selected={[...pickedIds(clauses)]}
      summarizeMultiple
      disablePortal
      labels={{ placeholder: message(locale, 'filter_builder_fields_placeholder') }}
      onSelectedChange={(next) => {
        const rows = pickFields(clauses, ctx, next);
        if (rows !== clauses) onchange(rows);
      }}
    />
  </div>

  {#if hasFieldRows}
    <div class="space-y-2">
      {#each clauses as clause, i (i)}
        {#if clause.kind === 'field'}
          <FieldRow
            {clause}
            field={ctx.fields.find((f) => fieldId(f) === fieldId(clause))}
            {locale}
            onchange={(next) => onchange(replaceAt(clauses, i, next))}
            onremove={() => onchange(removeAt(clauses, i))}
          />
        {/if}
      {/each}
    </div>
  {/if}

  <div class="space-y-2">
    {#each clauses as clause, i (i)}
      {#if clause.kind === 'stage'}
        <StageRow
          {clause}
          {ctx}
          {locale}
          onchange={(next) => onchange(replaceAt(clauses, i, next))}
          onremove={() => onchange(removeAt(clauses, i))}
        />
      {:else if clause.kind === 'when'}
        <WhenRow
          {clause}
          {locale}
          onchange={(next) => onchange(replaceAt(clauses, i, next))}
          onremove={() => onchange(removeAt(clauses, i))}
        />
      {:else if clause.kind === 'created_by'}
        <CreatedByRow
          {clause}
          {creators}
          {locale}
          onchange={(next) => onchange(replaceAt(clauses, i, next))}
          onremove={() => onchange(removeAt(clauses, i))}
        />
      {:else if clause.kind === 'rule'}
        <RuleRow
          {clause}
          typeLabel={typeLabel(clause.type)}
          {locale}
          onremove={() => onchange(removeAt(clauses, i))}
        />
      {/if}
    {/each}

    <div class="relative">
      <Button
        variant="outline"
        size="sm"
        class="w-full justify-start"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
      >
        <Plus class="mr-2 h-4 w-4" />
        {message(locale, 'filter_builder_add_other')}
      </Button>

      {#if menuOpen}
        <div
          class="absolute right-0 left-0 z-10 mt-1 overflow-hidden rounded-md border bg-popover shadow-md"
          role="menu"
          tabindex="-1"
          onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)}
        >
          {#each otherKinds(ctx) as kind (kind)}
            <button
              type="button"
              role="menuitem"
              class="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
              onclick={() => addOther(kind)}
            >
              {message(locale, OTHER_LABEL[kind])}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
