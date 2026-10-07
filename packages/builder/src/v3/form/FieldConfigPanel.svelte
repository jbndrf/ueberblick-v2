<script lang="ts">
  // v3 `form-editor/FieldConfigPanel.svelte` with scope "form" (`FormEditorView.svelte:442-456`): what the admin sets on
  // a field of this form. A header (back, type badge, type label), "Darstellung in diesem Formular", the validation
  // of a text or a multiselect, the link to the Felddefinition (v3 Panel 3, `openFieldDefinition`) and "Aus Formular
  // entfernen". The Felddefinition itself is WP-337's pane, opened by the link (`FieldPaneHost`). Every edit is
  // ops (`config.ts`) written through the editor's `write`, which shows a refusal in place.
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import type { Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import type { MessageKey } from '../../shell/messages';
  import { getBuilderContext } from '../shell/context';
  import { subjectTypeOf } from '../task/step-ops';
  import { formOf } from './model';
  import {
    fieldConfigOf,
    helpOps,
    placeholderOps,
    prefillOps,
    requiredOps,
    rulesOps,
    type Prefill,
  } from './config';
  import {
    addOfferedOptionOps,
    choiceOps,
    parseChoiceFilter,
    smartSourcesOf,
    smartFilter,
    toggleOption,
    optionsOf,
    type ChoiceFilter,
  } from './choice';
  import type { RulesPatch } from './constraint';
  import DisplaySection from './DisplaySection.svelte';
  import {
    entityConfigOf,
    roleSelectOps,
    displayOps,
    manyOps,
    rolesOps,
    seeOps,
    sourceOps,
    tableOps,
    tablesOf,
    type EntitySource,
  } from './entity';
  import EntitySelectorConfig from './EntitySelectorConfig.svelte';
  import SmartDropdownConfig from './SmartDropdownConfig.svelte';
  import { TYPE_ICONS } from './palette';
  import ValidationSection from './ValidationSection.svelte';

  interface Props {
    task: string;
    field: string;
    /** Applies ops; false when the file refused them (the editor shows why). */
    write: (ops: readonly Op[]) => boolean;
    onback: () => void;
    onremove: () => void;
    ondefinition: () => void;
  }
  let { task, field, write, onback, onremove, ondefinition }: Props = $props();

  const ctx = getBuilderContext();
  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const type = $derived(subjectTypeOf(file, task, ctx.type));
  const cfg = $derived(fieldConfigOf(file, task, type, field, ctx.locale));
  const propType = $derived(cfg.property?.type);
  const Icon = $derived(propType === undefined ? undefined : TYPE_ICONS[propType]);
  const typeLabel = $derived(propType === undefined ? '' : t(`field_type_${propType}` as MessageKey));
  const name = $derived(labelOf(cfg.property?.label, ctx.locale, field));

  const roles = $derived<MultiSelectOption[]>(
    Object.entries(file.roles ?? {}).map(([id, r]) => ({
      value: id,
      label: labelOf(r.label, ctx.locale, id),
    })),
  );

  // Smart Dropdown (WP-393): a select whose form entry has a `choice_filter`.
  const filter = $derived(parseChoiceFilter(formOf(file, task)[field]?.choice_filter));
  const smart = $derived((propType === 'select' || propType === 'multiselect') && filter.kind !== 'none');
  const sources = $derived(smartSourcesOf(file, task, ctx.type, field, ctx.locale));
  const options = $derived(optionsOf(file, type, field, ctx.locale));
  const multiOf = (f: ChoiceFilter): boolean =>
    f.kind === 'smart' && sources.find((s) => s.key === f.source)?.multi === true;
  const setFilter = (next: ChoiceFilter): void =>
    void write(choiceOps(doc, task, field, next, multiOf(next)));
  const onsource = (key: string | undefined): void => {
    const picked = sources.find((s) => s.key === key);
    setFilter(picked === undefined ? { kind: 'open' } : smartFilter(picked));
  };
  const ontoggle = (when: string, option: string, on: boolean): void =>
    setFilter(
      toggleOption(
        filter,
        when,
        option,
        on,
        options.map((o) => o.key),
      ),
    );
  const onadd = (label: string, when: string): void =>
    void write(addOfferedOptionOps(doc, task, type, field, filter, when, label, ctx.locale, multiOf(filter)));

  // Entity selector (WP-393): a reference to a table or a participant property.
  const entity = $derived(entityConfigOf(file, task, type, field, ctx.locale, doc.template));
  const tables = $derived(tablesOf(file, ctx.locale));
  const onentitysource = (s: EntitySource): void =>
    void write(
      sourceOps(
        doc,
        task,
        type,
        field,
        s,
        tables.map((x) => x.key),
        ctx.locale,
        t,
      ),
    );
  const onrules = (patch: RulesPatch): void =>
    void write(rulesOps(doc, task, field, type, patch, ctx.locale, t));
  const onprefill = (p: Prefill): void => void write(prefillOps(doc, task, field, type, p, ctx.locale, t));
</script>

<section class="panel" data-testid="field-config" data-key={field} aria-label={t('form_cfg_panel')}>
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
      {#if Icon !== undefined}
        <span class="badge" title={t('form_cfg_type_badge', { type: typeLabel })}><Icon size={16} /></span>
      {/if}
      <div class="names">
        <span class="type" data-testid="cfg-type">{typeLabel}</span>
        <span class="name" title={name}>{name}</span>
      </div>
    </div>
  </header>

  <div class="content">
    <DisplaySection
      {t}
      {cfg}
      onplaceholder={(text) => void write(placeholderOps(doc, task, field, ctx.locale, text))}
      onhelp={(text) => void write(helpOps(doc, type, field, ctx.locale, text))}
      onrequired={(on) => void write(requiredOps(doc, task, field, on))}
      {onprefill}
      {onrules}
    />
    <ValidationSection {t} {cfg} {onrules} />
    {#if smart}
      <SmartDropdownConfig {t} {filter} {sources} {options} {onsource} {ontoggle} {onadd} />
    {/if}
    {#if entity.source !== undefined}
      <EntitySelectorConfig
        {t}
        cfg={entity}
        {tables}
        {roles}
        onsource={onentitysource}
        ontable={(to) => void write(tableOps(doc, type, field, to))}
        onmany={(many) => void write(manyOps(doc, type, field, many, entity.manyLocked))}
        ondisplay={(display) => void write(displayOps(doc, type, field, display))}
        onsee={(ids) => void write(seeOps(doc, type, field, ids))}
        onlists={(lists) =>
          void write(
            entity.source === 'roles'
              ? roleSelectOps(doc, type, field, lists)
              : rolesOps(doc, task, type, field, lists, ctx.locale, t),
          )}
      />
    {/if}

    <button type="button" class="def-link" data-testid="cfg-edit-definition" onclick={ondefinition}>
      <span>{t('form_cfg_edit_definition')}</span>
      <ArrowRight size={16} />
    </button>
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
    transition: all 0.15s ease;
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
    overflow: hidden;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--foreground);
    text-overflow: ellipsis;
    white-space: nowrap;
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
    gap: 0.875rem;
    min-height: 0;
    padding: 0.75rem;
    overflow-y: auto;
  }
  .def-link {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.625rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--foreground);
    cursor: pointer;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    transition: all 0.15s ease;
  }
  .def-link:hover {
    background: var(--accent);
    border-color: color-mix(in oklab, var(--primary) 40%, transparent);
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
