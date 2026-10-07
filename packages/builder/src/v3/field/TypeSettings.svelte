<script lang="ts">
  // v3 `FieldConfigPanel.svelte:769-889` (the definition block): the limits of a number, the date mode with its
  // radio group, the allowed file types and the maximum number of files. They are settings of the property, so they
  // apply in every form; the pane says so in its heading. Date mode is the property type (owner Q8).
  import type { Property } from '@ueberblick/core';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import * as RadioGroup from '@ueberblick/ui/components/ui/radio-group';
  import type { MessageKey, Translate } from '../../shell/messages';
  import { DATE_MODES, FILE_PRESETS, filePresetOf, type FilePreset } from './type-ops';

  interface Props {
    t: Translate;
    prop: Property;
    onnumber: (part: 'min' | 'max', value: number | undefined) => void;
    onfiletypes: (preset: FilePreset) => void;
    onmaxfiles: (count: number | undefined) => void;
    ondatemode: (mode: (typeof DATE_MODES)[number]) => void;
  }
  let { t, prop, onnumber, onfiletypes, onmaxfiles, ondatemode }: Props = $props();

  const isNumber = $derived(prop.type === 'number' || prop.type === 'integer');
  const isDate = $derived(DATE_MODES.some((m) => m === prop.type));
  const preset = $derived(filePresetOf(prop));

  let min = $state('');
  let max = $state('');
  let files = $state('');
  $effect(() => {
    min = prop.min === undefined ? '' : String(prop.min);
    max = prop.max === undefined ? '' : String(prop.max);
    files = prop.max_files === undefined ? '' : String(prop.max_files);
  });

  const num = (value: unknown, whole: boolean): number | undefined => {
    const text = String(value ?? '').trim();
    const n = Number(text);
    return text === '' || !Number.isFinite(n) || (whole && (!Number.isInteger(n) || n < 1)) ? undefined : n;
  };
  const commitLimit = (part: 'min' | 'max'): void => {
    const value = num(part === 'min' ? min : max, false);
    if (value !== prop[part]) onnumber(part, value);
  };
  const commitFiles = (): void => {
    const value = num(files, true);
    if (value !== prop.max_files) onmaxfiles(value);
  };
  const presetLabel = (p: FilePreset): string => t(`field_file_${p === 'all' ? 'all' : p}` as MessageKey);
</script>

{#if isNumber}
  <div class="block" data-testid="type-number">
    <Label>{t('field_validation')}</Label>
    <div class="grid">
      <div class="cell">
        <Label for="num-min">{t('field_number_min')}</Label>
        <Input
          id="num-min"
          type="number"
          bind:value={min}
          onblur={() => commitLimit('min')}
          placeholder={t('field_number_no_min')}
          data-testid="field-min"
        />
      </div>
      <div class="cell">
        <Label for="num-max">{t('field_number_max')}</Label>
        <Input
          id="num-max"
          type="number"
          bind:value={max}
          onblur={() => commitLimit('max')}
          placeholder={t('field_number_no_max')}
          data-testid="field-max"
        />
      </div>
    </div>
  </div>
{/if}

{#if isDate}
  <div class="block" data-testid="type-date">
    <Label>{t('field_date_mode')}</Label>
    <RadioGroup.Root
      value={prop.type}
      onValueChange={(v: string | undefined) =>
        DATE_MODES.some((m) => m === v) && ondatemode(v as (typeof DATE_MODES)[number])}
      class="radios"
    >
      {#each DATE_MODES as mode (mode)}
        <div class="radio">
          <RadioGroup.Item value={mode} id={`date-${mode}`} data-testid={`date-mode-${mode}`} />
          <Label for={`date-${mode}`}>
            {t(
              mode === 'date'
                ? 'field_date_only'
                : mode === 'datetime'
                  ? 'field_date_and_time'
                  : 'field_time_only',
            )}
          </Label>
        </div>
      {/each}
    </RadioGroup.Root>
  </div>
{/if}

{#if prop.type === 'file'}
  <div class="block" data-testid="type-file">
    <Label for="file-types">{t('field_file_types')}</Label>
    <select
      id="file-types"
      class="native"
      value={preset}
      onchange={(e) => onfiletypes(e.currentTarget.value as FilePreset)}
      data-testid="field-file-types"
    >
      {#each FILE_PRESETS as p (p)}
        <option value={p}>{presetLabel(p)}</option>
      {/each}
      {#if preset === 'custom'}
        <option value="custom" disabled>{t('field_file_custom', { count: prop.accept?.length ?? 0 })}</option>
      {/if}
    </select>
  </div>
  <div class="block">
    <Label for="max-files">{t('field_max_files')}</Label>
    <Input
      id="max-files"
      type="number"
      min={1}
      bind:value={files}
      onblur={commitFiles}
      placeholder={'10'}
      data-testid="field-max-files"
    />
  </div>
{/if}

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .block > :global(label) {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .cell :global(label) {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .cell :global(input) {
    height: 2rem;
  }
  :global(.radios) {
    display: flex;
    flex-direction: column;
    gap: 0.375rem !important;
  }
  .radio {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
  }
  .radio :global(label) {
    margin: 0;
    font-size: 0.8125rem !important;
    color: var(--foreground) !important;
    cursor: pointer;
  }
  .native {
    width: 100%;
    height: 2.25rem;
    padding: 0 0.75rem;
    font-size: 0.8125rem;
    color: var(--foreground);
    cursor: pointer;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color-scheme: light dark;
  }
  .native:hover,
  .native:focus-visible {
    border-color: var(--primary);
    outline: none;
  }
</style>
