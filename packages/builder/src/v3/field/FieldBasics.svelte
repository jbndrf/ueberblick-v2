<script lang="ts">
  import { copyText } from '../shared/clipboard';
  // The top of the Felddefinition: label, key (with copy), type, the target of a reference and "Pflichtfeld".
  // Split from FieldPane (WP-412, R8); every edit still goes through the pane's `run` (one Doc op).
  import Check from '@lucide/svelte/icons/check';
  import Copy from '@lucide/svelte/icons/copy';
  import { PROPERTY_TYPES, type Property, type PropertyTypeKey, type TemplateFile } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import type { Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import type { MessageKey, Translate } from '../../shell/messages';
  import { setLabelOp, setRequiredOp } from './ops';

  interface Props {
    t: Translate;
    prop: Property;
    fieldKey: string;
    path: string;
    title: string;
    usageCount: number;
    file: TemplateFile;
    locale: string;
    typeKeys: readonly string[];
    run: (op: Op | undefined) => boolean;
    onchangetype: (next: PropertyTypeKey) => void;
    onsettarget: (to: string) => void;
  }
  const {
    t,
    prop,
    fieldKey: key,
    path,
    title,
    usageCount,
    file,
    locale,
    typeKeys,
    run,
    onchangetype,
    onsettarget,
  }: Props = $props();

  let copied = $state(false);

  function commitLabel(event: Event & { currentTarget: HTMLInputElement }): void {
    const text = event.currentTarget.value.trim();
    if (text === '' || !run(setLabelOp(file, path, locale, text))) event.currentTarget.value = title;
  }

  async function copyKey(): Promise<void> {
    if (await copyText(key)) {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    }
  }

  const typeLabel = (k: string): string => t(`field_type_${k}` as MessageKey);
</script>

<div class="group">
  <h4 class="title">{t('field_title')}</h4>
  <p class="hint">{t('field_scope', { count: usageCount })}</p>

  <div class="config">
    <label class="lbl" for="field-label">{t('field_label')}</label>
    <Input
      id="field-label"
      value={title}
      placeholder={t('field_label_placeholder')}
      onchange={commitLabel}
      data-testid="field-label"
    />
    <div class="key-row">
      <span class="key-name">{t('field_key')}</span>
      <code class="key" data-testid="field-key">{key}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        onclick={copyKey}
        aria-label={t('field_copy_key')}
        title={t('field_copy_key')}
      >
        {#if copied}<Check />{:else}<Copy />{/if}
      </Button>
      {#if copied}<span class="copied" role="status">{t('field_key_copied')}</span>{/if}
    </div>
  </div>

  <label class="type-row">
    <span class="lbl">{t('field_type')}</span>
    <select
      class="type-select"
      value={prop.type}
      onchange={(e) => onchangetype(e.currentTarget.value as PropertyTypeKey)}
      data-testid="field-type"
    >
      {#each PROPERTY_TYPES.keys as k (k)}
        <option value={k}>{typeLabel(k)}</option>
      {/each}
    </select>
    <span class="hint">{t('field_type_breaking')}</span>
  </label>

  {#if prop.type === 'reference'}
    <label class="type-row">
      <span class="lbl">{t('field_reference_to')}</span>
      <select
        class="type-select"
        value={prop.to}
        onchange={(e) => onsettarget(e.currentTarget.value)}
        data-testid="field-reference-to"
      >
        {#each typeKeys as k (k)}
          <option value={k}>{labelOf(file.types?.[k]?.label, locale, k)}</option>
        {/each}
      </select>
    </label>
  {/if}

  <label class="switch-row">
    <Switch
      checked={prop.required === true}
      onCheckedChange={(on: boolean) => run(setRequiredOp(file, path, on))}
      aria-label={t('field_required')}
      data-testid="field-required"
    />
    <span>{t('field_required')}</span>
  </label>
</div>

<style>
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .title {
    margin: 0;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .config {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .lbl {
    font-size: 0.8125rem;
    font-weight: 500;
  }
  .key-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2rem;
  }
  .key-name {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .key {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
  }
  .copied {
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .type-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .type-select {
    min-height: 2.25rem;
    border: 1px solid var(--input);
    border-radius: 0.375rem;
    background: var(--background);
    color: var(--foreground);
    padding: 0.25rem 0.5rem;
    font-size: 0.8125rem;
  }
  .type-select:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
  .switch-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2rem;
    font-size: 0.8125rem;
    cursor: pointer;
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
