<script lang="ts">
  // v3 `TaskConfigSidebar.svelte:276-332`, the Definition tab: Schaltflächentext, Farbe, Symbol,
  // Bestätigung verlangen (+ Nachricht), "Einstiegs-Task". New here, named by the work package: Beschreibung
  // and the phase the task is offered in; "Verknüpfte Objekte" (BindSection, A-053) edits the task's `bind`.
  // Farbe, Symbol and Bestätigung write `button.color`, `button.icon`
  // and `confirm` (WP-616): the colour is a registry key or `#rrggbb`.
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { TASK_BUTTON_COLORS } from '@ueberblick/core';
  import type { Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import type { BuilderContext } from '../shell/context';
  import BindSection from './BindSection.svelte';
  import { buttonOps, confirmOps, confirmTextOps } from './button-ops';
  import { commitOps } from './commit';
  import { descriptionOps, entryOps, labelOps, localizedText, stageOf, stageOps, stageSourceOf } from './ops';

  interface Props {
    ctx: BuilderContext;
    task: string;
  }
  let { ctx, task }: Props = $props();

  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const def = $derived(file.tasks?.[task]);
  const label = $derived(localizedText(def?.label, ctx.locale));
  const description = $derived(localizedText(def?.description, ctx.locale));
  const entry = $derived(def?.on === '$map');
  const source = $derived(stageSourceOf(file, task, ctx.type));
  const property = $derived(source?.property);
  const stages = $derived(
    Object.entries(
      source === undefined ? {} : (file.types?.[source.type]?.properties[source.property]?.options ?? {}),
    ).map(([key, l]) => ({ key, name: labelOf(l, ctx.locale, key) })),
  );
  const pinned = $derived(
    property === undefined ? ({ ok: true, options: [] } as const) : stageOf(def?.when, property),
  );
  const pinValue = $derived(pinned.ok && pinned.options.length === 1 ? (pinned.options[0] as string) : '');
  const several = $derived(pinned.ok && pinned.options.length > 1);

  // v3's placeholders for the colour and the icon.
  const COLOR_EXAMPLE = '#3b82f6';
  const ICON_EXAMPLE = 'check';
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const color = $derived(def?.button?.color ?? '');
  const icon = $derived(def?.button?.icon ?? '');
  const confirmed = $derived(def?.confirm !== undefined);
  const confirmText = $derived(localizedText(def?.confirm, ctx.locale));
  let error: string | undefined = $state();
  const scope = $derived(`tasks.${task}`);

  function write(ops: readonly Op[] | undefined): void {
    error = ops === undefined ? t('tp_stage_text_only') : commitOps(ctx, ops, scope);
  }
</script>

<div class="tab" data-testid="task-tab-definition">
  <label class="field">
    <span class="caption">{t('tp_button_label')}</span>
    <Input
      data-testid="task-label"
      value={label}
      onchange={(e) => {
        const text = e.currentTarget.value;
        if (text.trim() === '') e.currentTarget.value = label;
        else write(labelOps(doc, task, ctx.locale, text));
      }}
    />
  </label>

  <label class="field">
    <span class="caption">{t('tp_description')}</span>
    <textarea
      class="area"
      rows="2"
      data-testid="task-description"
      value={description}
      placeholder={t('tp_description_placeholder')}
      onchange={(e) => write(descriptionOps(doc, task, ctx.locale, e.currentTarget.value))}
    ></textarea>
  </label>

  <label class="field">
    <span class="caption">{t('tp_stage')}</span>
    <select
      class="select"
      data-testid="task-stage"
      value={pinValue}
      disabled={property === undefined || !pinned.ok || several || entry}
      onchange={(e) =>
        property !== undefined && write(stageOps(doc, task, property, e.currentTarget.value || undefined))}
    >
      <option value="">{t('tp_stage_any')}</option>
      {#if several}<option value="" selected disabled>{t('tp_stage_several')}</option>{/if}
      {#each stages as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
    </select>
    {#if property === undefined}
      <span class="hint">{t('catalog_no_process')}</span>
    {:else if !pinned.ok || several}
      <span class="hint">{t('tp_stage_text_only')}</span>
    {:else}
      <span class="hint">{t('tp_stage_hint')}</span>
    {/if}
  </label>

  <div class="presentation">
    <div class="pair">
      <label class="field">
        <span class="caption">{t('tp_color')}</span>
        <span class="color-row">
          <input
            type="color"
            class="swatch"
            data-testid="task-color-swatch"
            value={HEX.test(color) ? color : COLOR_EXAMPLE}
            aria-label={t('tp_color')}
            onchange={(e) => write(buttonOps(doc, task, 'color', e.currentTarget.value))}
          />
          <Input
            data-testid="task-color"
            list="task-colors"
            value={color}
            placeholder={COLOR_EXAMPLE}
            onchange={(e) => write(buttonOps(doc, task, 'color', e.currentTarget.value))}
          />
          <datalist id="task-colors">
            {#each TASK_BUTTON_COLORS.keys as k (k)}<option value={k}></option>{/each}
          </datalist>
        </span>
      </label>
      <label class="field">
        <span class="caption">{t('tp_icon')}</span>
        <Input
          data-testid="task-icon"
          value={icon}
          placeholder={ICON_EXAMPLE}
          onchange={(e) => write(buttonOps(doc, task, 'icon', e.currentTarget.value))}
        />
      </label>
    </div>
    <label class="check">
      <input
        type="checkbox"
        data-testid="task-confirm"
        checked={confirmed}
        onchange={(e) =>
          write(confirmOps(doc, task, ctx.locale, e.currentTarget.checked, t('tp_confirm_default')))}
      />{t('tp_confirm')}
    </label>
    {#if confirmed}
      <label class="field">
        <span class="caption">{t('tp_confirm_message')}</span>
        <Input
          data-testid="task-confirm-message"
          value={confirmText}
          onchange={(e) => {
            const text = e.currentTarget.value;
            if (text.trim() === '') e.currentTarget.value = confirmText;
            else write(confirmTextOps(doc, task, ctx.locale, text));
          }}
        />
      </label>
    {/if}
  </div>

  <BindSection {ctx} {task} />

  <label class="check entry">
    <input
      type="checkbox"
      data-testid="task-entry"
      checked={entry}
      onchange={(e) => write(entryOps(doc, task, ctx.type, e.currentTarget.checked))}
    />
    <span>{t('tp_entry')}</span>
  </label>
  {#if entry}<p class="hint">{t('tp_entry_hint')}</p>{/if}

  {#if error !== undefined}<p class="error" role="alert" data-testid="task-error">{error}</p>{/if}
</div>

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    flex: 1;
  }
  .caption {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .area,
  .select {
    width: 100%;
    padding: 0.375rem 0.5rem;
    font-size: 0.875rem;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--input);
    border-radius: 0.375rem;
  }
  .select {
    height: 2.25rem;
    padding: 0 0.5rem;
  }
  .area:focus-visible,
  .select:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
  .select:disabled {
    opacity: 0.6;
  }
  .presentation {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .pair {
    display: flex;
    gap: 0.5rem;
  }
  .color-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .swatch {
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.25rem;
    padding: 0.125rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
  }
  .entry {
    margin-top: 0.25rem;
    padding-top: 0.5rem;
    border-top: 1px solid color-mix(in oklab, var(--border) 40%, transparent);
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
  @media (max-width: 640px) {
    .select {
      height: 2.75rem;
      font-size: 1rem;
    }
    .area {
      font-size: 1rem;
    }
  }
</style>
