<script lang="ts">
  // One field of the task form, drawn with the v3 kit (reference FieldRenderer.svelte:662-760). The value shape is
  // what core.form expects: text/number/date as scalars, select as the option key, multiselect as a list of keys,
  // reference and participant as the id, file and geometry through the tool slot.
  import type { Snippet } from 'svelte';
  import { MultiSelect, type MultiSelectOption } from '../components/ui/multi-select';
  import { Checkbox } from '../components/ui/checkbox';
  import { Input } from '../components/ui/input';
  import { Label } from '../components/ui/label';
  import { Textarea } from '../components/ui/textarea';
  import { instantToLocal, localToInstant } from '@ueberblick/core/form';
  import { m } from '../paraglide/messages.js';
  import { describedBy, errorId, hintId } from './chrome';
  import FieldChrome from './FieldChrome.svelte';
  import Link2Icon from '@lucide/svelte/icons/link-2';
  import { Badge } from '../components/ui/badge';
  import type { Choice, FormField, Json, ToolSlot } from './contract';
  import { localize } from './localize';
  import { localizedShown, localizedWith } from './localized';
  import { EMAIL_TOKEN, MULTILINE_TOKEN } from './model';
  import { fileRefs } from './gallery/files';
  import MediaGallery from './gallery/MediaGallery.svelte';

  interface Props {
    field: FormField;
    value: Json | undefined;
    locale: string;
    required: boolean;
    readonly: boolean;
    /** The record view (FormRenderer `readonly`): `aria-readonly`, never `disabled`; a choice shows its labels as text. */
    view?: boolean;
    error?: string | undefined;
    choices?: readonly Choice[] | undefined;
    /** Option keys the form entry's choice_filter offers; undefined: all of `field.options`. */
    offered?: readonly string[] | undefined;
    /** A filtered select whose source field is empty: a hint stands in for the select (v3 `FieldRenderer.svelte:756-766`). */
    waiting?: boolean;
    tool?: Snippet<[ToolSlot]> | undefined;
    onchange: (value: Json) => void;
  }
  let {
    field,
    value,
    locale,
    required,
    readonly,
    view = false,
    error,
    choices,
    offered,
    waiting = false,
    tool,
    onchange,
  }: Props = $props();

  const label = $derived(localize(field.label, locale));
  // A field of a bound Objekt names that Objektart (A-047).
  const origin = $derived(
    field.origin ? m.form_origin({ objektart: localize(field.origin, locale) }) : undefined,
  );
  const hint = $derived(field.description ? localize(field.description, locale) : undefined);
  const described = $derived(describedBy(field.id, hint !== undefined, error !== undefined));
  // The option's explanation text shows under its label (v3 mobile-multi-select.svelte:548-551 `getOptionDescription`).
  const options = $derived<MultiSelectOption[]>(
    Object.entries(field.options ?? {})
      .filter(([k]) => offered === undefined || offered.includes(k))
      .map(([k, v]) => {
        const h = field.optionHints?.[k];
        return {
          value: k,
          label: localize(v, locale),
          ...(h !== undefined && { description: localize(h, locale) }),
        };
      }),
  );
  const picks = $derived<MultiSelectOption[]>(
    field.input === 'choice' ? (choices ?? []).map((o) => ({ value: o.value, label: o.label })) : options,
  );
  // select and a single choice hold a key; multiselect and a many choice (Mehrfachauswahl) a list of keys.
  const several = $derived(field.input === 'multiselect' || field.multiple === true);
  const chosen = $derived(
    Array.isArray(value) ? (value as string[]) : typeof value === 'string' && value !== '' ? [value] : [],
  );
  const multiline = $derived(field.appearance.includes(MULTILINE_TOKEN));
  const inputType = $derived(
    field.input === 'number' ? 'number' : field.appearance.includes(EMAIL_TOKEN) ? 'email' : 'text',
  );
  // v3 FieldRenderer.svelte:699: an e-mail field without its own placeholder shows an example address.
  const placeholder = $derived(
    field.placeholder
      ? localize(field.placeholder, locale)
      : field.input === 'text' && field.appearance.includes(EMAIL_TOKEN)
        ? 'email@example.com'
        : undefined,
  );
  const choiceLabels = $derived.by(() => {
    const p = placeholder ?? (several ? undefined : m.form_choose());
    return p === undefined ? {} : { placeholder: p };
  });
  const slot = $derived<ToolSlot>({ field, value, set: onchange, id: field.id });
  const text = $derived(
    field.input === 'localized_text'
      ? localizedShown(value, locale)
      : value === undefined || value === null
        ? ''
        : String(value),
  );
  // A localized_text field edits the value of the participant's locale and keeps the others.
  const typed = (v: string) =>
    onchange(field.input === 'localized_text' ? localizedWith(value, locale, v) : v);
  // A datetime input holds the device's wall-clock time; the value is an instant (core.form, WP-835).
  const offsetAt = (t: string): number => (t === '' ? 0 : -new Date(t).getTimezoneOffset());
  const invalid = $derived(error ? 'true' : undefined);

  const files = $derived(field.type === 'file' ? fileRefs(value) : []);
  const removeFile = (i: number) => {
    const rest = files.filter((_, at) => at !== i);
    onchange(rest.length > 0 ? rest.map((f) => ({ ...f })) : null);
  };

  const empty = (v: string) => (v === '' ? null : v);
</script>

{#if field.computed}
  <FieldChrome id={field.id} {label} required={false} {hint} {error}>
    <div
      id={field.id}
      class="rounded-md border border-input bg-muted/30 px-3 py-2 text-sm"
      data-testid="computed-field"
    >
      {#if value !== undefined && value !== null && value !== ''}{String(value)}{:else}<span
          class="text-muted-foreground italic">{m.form_computed_will()}</span
        >{/if}
    </div>
    <Badge variant="secondary" class="mt-1.5 gap-1 text-[10px]" data-testid="computed-badge"
      >{m.form_computed_badge()}</Badge
    >
  </FieldChrome>
{:else if field.input === 'checkbox'}
  <div class="space-y-1.5" data-testid="field" data-field-id={field.id}>
    <div class="flex items-center gap-2">
      <Checkbox
        id={field.id}
        checked={value === true}
        disabled={readonly}
        readonly={view}
        aria-invalid={invalid}
        aria-describedby={described}
        onCheckedChange={(on) => onchange(on === true)}
      />
      <Label for={field.id} class="text-sm font-medium">
        {label}
        {#if required}<span class="text-destructive" aria-hidden="true">*</span><span class="sr-only"
            >({m.ui_required()})</span
          >{/if}
      </Label>
    </div>
    {#if hint}<p class="text-xs text-muted-foreground" id={hintId(field.id)}>{hint}</p>{/if}
    {#if origin}
      <Badge variant="secondary" class="mt-1.5 gap-1 text-[10px]" data-testid="field-origin"
        ><Link2Icon aria-hidden="true" />{origin}</Badge
      >
    {/if}
    {#if error}<p class="text-xs text-destructive" id={errorId(field.id)}>{error}</p>{/if}
  </div>
{:else if field.input === 'tool'}
  <FieldChrome id={field.id} {label} {required} {hint} {error} {origin}>
    <div id={field.id} tabindex="-1" role="group" aria-labelledby={`${field.id}-label`}>
      {#if files.length > 0}<MediaGallery
          {files}
          mode={readonly ? 'view' : 'fill'}
          onRemove={removeFile}
        />{/if}
      {#if tool}
        {@render tool(slot)}
      {:else}
        <p class="text-xs text-muted-foreground">{m.form_tool_missing()}</p>
      {/if}
    </div>
  </FieldChrome>
{:else}
  <FieldChrome id={field.id} {label} {required} {hint} {error} {origin} labelFor={field.id}>
    {#if view && (field.input === 'select' || field.input === 'choice' || field.input === 'multiselect')}
      <Input
        id={field.id}
        type="text"
        readonly
        aria-readonly="true"
        value={chosen.map((c) => picks.find((p) => p.value === c)?.label ?? c).join(', ')}
        aria-describedby={described}
      />
    {:else if waiting && !readonly && (field.input === 'select' || field.input === 'multiselect')}
      <div
        id={field.id}
        class="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        data-testid="dependent-hint"
        aria-describedby={described}
      >
        {m.form_select_dependent_first()}
      </div>
    {:else if field.input === 'select' || field.input === 'choice' || field.input === 'multiselect'}
      <MultiSelect
        id={field.id}
        options={picks}
        selected={chosen}
        singleSelect={!several}
        labels={choiceLabels}
        disabled={readonly}
        invalid={error !== undefined}
        describedby={described}
        onSelectedChange={(ids) => onchange(several ? ids : (ids[0] ?? null))}
      />
    {:else if (field.input === 'text' || field.input === 'localized_text') && multiline}
      <Textarea
        id={field.id}
        rows={4}
        {placeholder}
        value={text}
        disabled={readonly}
        readonly={view}
        aria-readonly={view ? 'true' : undefined}
        aria-invalid={invalid}
        aria-describedby={described}
        oninput={(e) => typed(e.currentTarget.value)}
      />
    {:else if field.input === 'date' || field.input === 'datetime' || field.input === 'time'}
      <Input
        id={field.id}
        type={field.input === 'date' ? 'date' : field.input === 'time' ? 'time' : 'datetime-local'}
        value={field.input === 'datetime' ? instantToLocal(text, offsetAt(text)) : text}
        disabled={readonly}
        readonly={view}
        aria-readonly={view ? 'true' : undefined}
        aria-invalid={invalid}
        aria-describedby={described}
        oninput={(e) =>
          onchange(
            field.input === 'datetime'
              ? empty(localToInstant(e.currentTarget.value, offsetAt(e.currentTarget.value)))
              : empty(e.currentTarget.value),
          )}
      />
    {:else}
      <Input
        id={field.id}
        type={inputType}
        min={field.input === 'number' ? field.min : undefined}
        max={field.input === 'number' ? field.max : undefined}
        {placeholder}
        value={text}
        disabled={readonly}
        readonly={view}
        aria-readonly={view ? 'true' : undefined}
        aria-invalid={invalid}
        aria-describedby={described}
        oninput={(e) =>
          field.input === 'number'
            ? onchange(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))
            : typed(e.currentTarget.value)}
      />
    {/if}
  </FieldChrome>
{/if}
