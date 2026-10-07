<script lang="ts">
  // The field panel of a form entry `<bind>.<property>` (A-047). v3 `FieldConfigPanel.svelte` (scope "form") showed
  // the placement of a related field with its `read_only` flag (default editable); here: the same header (back,
  // type badge, type, name), the origin, Platzhalter (the form entry's), Hilfetext, "Schreibgeschützt" (the form
  // entry's `readonly`), "Pflichtfeld" and "Aus Formular entfernen" (v3 kept all of them, only Prefill was hidden for
  // a related field, FieldConfigPanel.svelte:562-622). The engine has no per-form hint, so the Hilfetext is the
  // linked property's `description` as for the task's own fields (WP-672); the rest of the definition (label,
  // options) is edited on the linked Objektart, not from this form.
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import { localizeExact, type LocalizedString } from '@ueberblick/core';
  import type { Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import type { MessageKey } from '../../shell/messages';
  import { getBuilderContext } from '../shell/context';
  import { boundOf, splitBindKey } from './bound';
  import { helpOps, placeholderOps, readonlyOps, requiredOps } from './config';
  import { formOf } from './model';
  import { TYPE_ICONS } from './palette';

  interface Props {
    task: string;
    field: string;
    write: (ops: readonly Op[]) => boolean;
    onback: () => void;
    onremove: () => void;
  }
  let { task, field, write, onback, onremove }: Props = $props();

  const ctx = getBuilderContext();
  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const link = $derived(splitBindKey(field));
  const target = $derived(boundOf(file, task, ctx.type, ctx.locale).find((x) => x.name === link?.bind));
  const prop = $derived(target?.properties.find((p) => p.key === link?.property)?.property);
  const entry = $derived(formOf(file, task)[field]);
  const readonly = $derived(entry?.readonly === true);
  const byExpr = $derived(typeof entry?.readonly === 'string');
  const required = $derived(entry?.required === true);
  const Icon = $derived(prop === undefined ? Link2 : TYPE_ICONS[prop.type]);
  const typeLabel = $derived(prop === undefined ? '' : t(`field_type_${prop.type}` as MessageKey));
  const textOf = (v: unknown): string =>
    typeof v === 'string' || (typeof v === 'object' && v !== null)
      ? localizeExact(v as LocalizedString, ctx.locale)
      : '';
  const placeholderNow = $derived(textOf(entry?.placeholder));
  const helpNow = $derived(textOf(prop?.description));
  let placeholder = $state('');
  let help = $state('');
  $effect(() => {
    placeholder = placeholderNow;
    help = helpNow;
  });
  const name = $derived(labelOf(entry?.label ?? prop?.label, ctx.locale, field));
</script>

<section class="panel" data-testid="linked-config" data-key={field} aria-label={t('form_cfg_panel')}>
  <header class="head">
    <button
      type="button"
      class="back"
      aria-label={t('form_back')}
      title={t('form_back')}
      data-testid="form-field-back"
      onclick={onback}
    >
      <ArrowLeft size={16} />
    </button>
    <div class="info">
      <span class="badge"><Icon size={16} /></span>
      <div class="names">
        <span class="type" data-testid="cfg-type">{typeLabel}</span>
        <span class="name" title={name}>{name}</span>
      </div>
    </div>
  </header>

  <div class="content">
    <p class="hint" data-testid="linked-scope">
      {t('form_linked_scope', { objektart: target?.typeLabel ?? link?.bind ?? '' })}
    </p>
    {#if prop?.computed === undefined}
      <div class="row">
        <Label for="cfg-placeholder">{t('form_cfg_placeholder')}</Label>
        <Input
          id="cfg-placeholder"
          bind:value={placeholder}
          onblur={() =>
            placeholder !== placeholderNow &&
            void write(placeholderOps(doc, task, field, ctx.locale, placeholder))}
          placeholder={t('form_cfg_placeholder_text')}
          data-testid="cfg-placeholder"
        />
      </div>
    {/if}
    <div class="row">
      <Label for="cfg-help">{t('form_cfg_help')}</Label>
      <Textarea
        id="cfg-help"
        bind:value={help}
        onblur={() =>
          help !== helpNow &&
          link !== undefined &&
          target !== undefined &&
          void write(helpOps(doc, target.type, link.property, ctx.locale, help))}
        placeholder={t('form_cfg_help_placeholder')}
        rows={2}
        data-testid="cfg-help"
      />
      <p class="hint">{t('form_cfg_help_scope')}</p>
    </div>
    <div class="switch">
      <Switch
        id="cfg-linked-readonly"
        checked={readonly || byExpr}
        disabled={byExpr}
        onCheckedChange={(on: boolean) => void write(readonlyOps(doc, task, field, on))}
        data-testid="cfg-readonly"
      />
      <Label for="cfg-linked-readonly">{t('form_linked_readonly')}</Label>
    </div>
    <p class="hint">
      {byExpr
        ? t('form_linked_readonly_expr', { expr: String(entry?.readonly) })
        : t('form_linked_readonly_hint')}
    </p>
    <div class="switch">
      <Switch
        id="cfg-linked-required"
        checked={required || prop?.required === true}
        disabled={prop?.required === true || typeof entry?.required === 'string'}
        onCheckedChange={(on: boolean) => void write(requiredOps(doc, task, field, on))}
        data-testid="cfg-required"
      />
      <Label for="cfg-linked-required">{t('form_cfg_required')}</Label>
    </div>
    <p class="hint">{t('form_linked_missing')}</p>
  </div>

  <footer class="foot">
    <Button variant="outline" size="sm" onclick={onremove} data-testid="cfg-remove">
      <Trash2 />
      {t('form_menu_remove')}
    </Button>
  </footer>
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background: var(--card);
  }
  .head {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .back {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    color: var(--muted-foreground);
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }
  .back:hover {
    color: var(--foreground);
    background: var(--accent);
    border-color: var(--primary);
  }
  .info {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .badge {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    color: var(--primary);
    background: color-mix(in oklab, var(--primary) 10%, transparent);
    border-radius: 0.375rem;
  }
  .names {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .type {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--foreground);
  }
  .name {
    overflow: hidden;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .content {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
    padding: 0.75rem;
    overflow-y: auto;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .foot {
    flex-shrink: 0;
    padding: 0.75rem;
    border-top: 1px solid var(--border);
  }
  .foot :global(button) {
    width: 100%;
  }
</style>
