<script lang="ts">
  // One row of "Felder filtern" (the v3 property-row component with its four editors): text contains
  // (ClauseTextContains), number Min/Max (ClauseNumberRange), date from/to (ClauseDateRange) and a choice through the
  // kit MultiSelect (ClauseOptionMultiSelect, v3's MobileMultiSelect). Written as rule-language source by core.
  import type { BuilderField, FieldClause } from '@ueberblick/core/filters';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { MultiSelect } from '@ueberblick/ui/components/ui/multi-select';
  import { message, type Locale } from '../../../messages';
  import ClauseFrame from './ClauseFrame.svelte';
  import ToggleButtons from './ToggleButtons.svelte';

  interface Props {
    clause: FieldClause;
    /** The offered field of the row; none when the person may no longer read it (the row stays, its value is kept). */
    field: BuilderField | undefined;
    locale: Locale;
    onchange: (next: FieldClause) => void;
    onremove: () => void;
  }
  let { clause, field, locale, onchange, onremove }: Props = $props();

  /** A bound, null when cleared, undefined when the text is no number (the clause then stays as it was). */
  const bound = (raw: string): number | null | undefined => {
    const t = raw.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  };
</script>

<ClauseFrame {locale} kind="field" title={field?.label ?? clause.key} subtitle={field?.typeLabel} {onremove}>
  {#if clause.editor === 'text'}
    <Input
      type="text"
      class="h-9"
      placeholder={message(locale, 'filter_clause_text_placeholder')}
      aria-label={field?.label ?? clause.key}
      value={clause.text}
      oninput={(e) => onchange({ ...clause, text: e.currentTarget.value })}
    />
  {:else if clause.editor === 'number'}
    {@const set = (side: 'min' | 'max', raw: string): void => {
      const v = bound(raw);
      if (v !== undefined) onchange({ ...clause, [side]: v });
    }}
    <div class="grid grid-cols-2 gap-2">
      <Input
        type="number"
        class="h-9"
        placeholder={message(locale, 'filter_clause_number_min')}
        aria-label={message(locale, 'filter_clause_number_min')}
        value={clause.min ?? ''}
        oninput={(e) => set('min', e.currentTarget.value)}
      />
      <Input
        type="number"
        class="h-9"
        placeholder={message(locale, 'filter_clause_number_max')}
        aria-label={message(locale, 'filter_clause_number_max')}
        value={clause.max ?? ''}
        oninput={(e) => set('max', e.currentTarget.value)}
      />
    </div>
  {:else if clause.editor === 'date'}
    <div class="grid grid-cols-2 gap-2">
      <Input
        type="date"
        class="h-9"
        aria-label={message(locale, 'filter_builder_date_from')}
        value={clause.from ?? ''}
        onchange={(e) => onchange({ ...clause, from: e.currentTarget.value || null })}
      />
      <Input
        type="date"
        class="h-9"
        aria-label={message(locale, 'filter_builder_date_to')}
        value={clause.to ?? ''}
        onchange={(e) => onchange({ ...clause, to: e.currentTarget.value || null })}
      />
    </div>
  {:else if clause.editor === 'boolean'}
    <ToggleButtons
      options={[
        { value: 'yes', label: message(locale, 'filter_builder_bool_yes') },
        { value: 'no', label: message(locale, 'filter_builder_bool_no') },
      ]}
      selected={clause.value === null ? null : clause.value ? 'yes' : 'no'}
      onchange={(v) => onchange({ ...clause, value: v === null ? null : v === 'yes' })}
    />
  {:else if clause.editor === 'presence'}
    <ToggleButtons
      options={[
        { value: 'empty', label: message(locale, 'filter_builder_presence_empty') },
        { value: 'filled', label: message(locale, 'filter_builder_presence_filled') },
      ]}
      selected={clause.state}
      onchange={(v) => onchange({ ...clause, state: v === null ? null : v === 'empty' ? 'empty' : 'filled' })}
    />
  {:else if clause.editor === 'participant'}
    <label class="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={clause.me} onCheckedChange={(next) => onchange({ ...clause, me: next === true })} />
      <span>{message(locale, 'filter_builder_me')}</span>
    </label>
  {:else if clause.editor === 'time'}
    <div class="grid grid-cols-2 gap-2">
      <Input
        type="time"
        class="h-9"
        aria-label={message(locale, 'filter_builder_date_from')}
        value={clause.from ?? ''}
        onchange={(e) => onchange({ ...clause, from: e.currentTarget.value || null })}
      />
      <Input
        type="time"
        class="h-9"
        aria-label={message(locale, 'filter_builder_date_to')}
        value={clause.to ?? ''}
        onchange={(e) => onchange({ ...clause, to: e.currentTarget.value || null })}
      />
    </div>
  {:else if field === undefined || field.options.length === 0}
    <p class="text-xs text-muted-foreground">{message(locale, 'filter_clause_no_options')}</p>
  {:else}
    <MultiSelect
      options={field.options.map((o) => ({ value: o.value, label: o.label }))}
      selected={[...clause.values]}
      labels={{ placeholder: message(locale, 'filter_clause_options_placeholder') }}
      disablePortal
      onSelectedChange={(values) => {
        if (values.length !== clause.values.length || values.some((v, i) => v !== clause.values[i]))
          onchange({ ...clause, values });
      }}
    />
  {/if}
</ClauseFrame>
