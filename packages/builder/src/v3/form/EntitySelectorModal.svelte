<script lang="ts">
  // v3 `form-editor/EntitySelectorModal.svelte`: the dialog of the entity selector. For a Tabelle: the table (a
  // searchable select, a sheet on a phone) and "Rollen mit Sichtbarkeit". For Teilnehmende: "Nur Selbstauswahl"
  // and "Kann jeden auswählen". "Mehrfachauswahl erlauben" (a switch, first, for both sources: `cardinality: many`)
  // and, for a Tabelle, "Anzeigefeld" (the property of the table the picker shows: `display_property`, A-048) sit
  // where v3 had them (EntitySelectorModal.svelte:293-340). v3's hint of "Rollen mit Sichtbarkeit" said "leer: niemand sieht etwas"; every
  // role picker here means "leer: alle". Every pick is written at once (v3 on "Fertig"); "Fertig" closes.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { MultiSelect, type MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import type { Translate } from '../../shell/messages';
  import RoleSelect from '../shared/RoleSelect.svelte';
  import { kitLabels } from '../shared/kit-labels';
  import type { EntityConfig, EntitySource, TableChoice } from './entity';

  interface Props {
    open: boolean;
    t: Translate;
    cfg: EntityConfig;
    source: EntitySource;
    sourceLabel: string;
    tables: readonly TableChoice[];
    roles: readonly MultiSelectOption[];
    ontable: (table: string) => void;
    onmany: (many: boolean) => void;
    ondisplay: (display: string | undefined) => void;
    onsee: (ids: string[]) => void;
    onlists: (lists: { any: string[]; self: string[] }) => void;
  }
  let {
    open = $bindable(false),
    t,
    cfg,
    source,
    sourceLabel,
    tables,
    roles,
    ontable,
    onmany,
    ondisplay,
    onsee,
    onlists,
  }: Props = $props();

  // Rollen: the property's `select` (A-055); Teilnehmende: the form entry's constraint.
  const lists = $derived(
    source === 'roles'
      ? cfg.roleSelect
      : cfg.constraint.foreign
        ? { any: [], self: [] }
        : cfg.constraint.roles,
  );
  const seen = $derived(cfg.see.kind === 'roles' ? [...cfg.see.roles] : []);
  const choices = $derived<MultiSelectOption[]>(
    tables.map((x) => ({ value: x.key, label: x.label, description: x.description })),
  );
  // The table the field points at stays listed even when it is not a table (a reference written in the code view).
  const withCurrent = $derived(
    cfg.table === undefined || choices.some((c) => c.value === cfg.table)
      ? choices
      : [...choices, { value: cfg.table, label: cfg.table }],
  );
  // "Anzeigefeld": the table's properties; the first entry is the default, the display name (B-014).
  const DEFAULT_DISPLAY = '';
  const columns = $derived<MultiSelectOption[]>([
    { value: DEFAULT_DISPLAY, label: t('form_entity_display_default') },
    ...cfg.columns.map((c) => ({ value: c.key, label: c.label, description: c.kind })),
  ]);
  const columnLabels = $derived(
    kitLabels(t, {
      placeholder: t('form_entity_display_placeholder'),
      dialog: t('form_entity_display'),
      options: t('form_entity_display'),
    }),
  );
  const labels = $derived(
    kitLabels(t, {
      placeholder: t('form_entity_table_placeholder'),
      dialog: t('form_entity_table_label'),
      options: t('form_entity_table_label'),
    }),
  );
  const summary = $derived(
    source === 'roles' && lists.self.length + lists.any.length > 0
      ? t('form_entity_others_none')
      : lists.self.length > 0
        ? t('form_entity_others_any')
        : lists.any.length > 0
          ? t('form_entity_others_self')
          : t('form_entity_everyone'),
  );
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="entity-modal sm:max-w-[500px]" data-testid="entity-modal">
    <Dialog.Header>
      <Dialog.Title>{t('form_entity_title', { source: sourceLabel })}</Dialog.Title>
      <Dialog.Description>
        {source === 'table'
          ? t('form_entity_desc_table')
          : source === 'roles'
            ? t('form_entity_desc_roles')
            : t('form_entity_desc_participants')}
      </Dialog.Description>
    </Dialog.Header>

    <div class="body">
      <div class="row" data-testid="entity-many-row">
        <div class="row-text">
          <Label for="entity-many">{t('form_entity_many')}</Label>
          <p class="hint">{cfg.manyLocked ? t('form_entity_many_locked') : t('form_entity_many_hint')}</p>
        </div>
        <Switch
          id="entity-many"
          checked={cfg.many}
          disabled={cfg.many && cfg.manyLocked}
          onCheckedChange={(on: boolean) => onmany(on)}
          data-testid="entity-many"
        />
      </div>
      {#if source === 'table'}
        <div class="section">
          <Label>{t('form_entity_table_label')}</Label>
          <MultiSelect
            options={withCurrent}
            selected={cfg.table === undefined ? [] : [cfg.table]}
            singleSelect
            {labels}
            onSelectedChange={(ids: string[]) => ids[0] !== undefined && ontable(ids[0])}
            class="w-full"
          />
        </div>
        <div class="section" data-testid="entity-display">
          <Label>{t('form_entity_display')}</Label>
          <p class="hint">{t('form_entity_display_hint')}</p>
          <MultiSelect
            options={columns}
            selected={[cfg.display ?? DEFAULT_DISPLAY]}
            singleSelect
            labels={columnLabels}
            onSelectedChange={(ids: string[]) =>
              ids[0] !== undefined && ondisplay(ids[0] === DEFAULT_DISPLAY ? undefined : ids[0])}
            class="w-full"
          />
        </div>
        <RoleSelect
          testid="entity-see"
          label={t('form_entity_see')}
          help={cfg.see.kind === 'row' ? t('field_roles_row_hint') : t('form_entity_see_hint')}
          {t}
          {roles}
          selectedIds={seen}
          disabled={cfg.see.kind === 'row'}
          onchange={onsee}
        />
      {:else if source !== 'roles' && cfg.constraint.foreign}
        <div class="section">
          <Label>{t('form_smart_rule')}</Label>
          <code class="expr" data-testid="entity-foreign">{cfg.constraint.expr}</code>
          <p class="hint">{t('form_entity_foreign')}</p>
        </div>
      {:else}
        {#if source === 'roles'}
          <p class="hint" data-testid="entity-roles-hint">{t('form_entity_roles_hint')}</p>
        {/if}
        <RoleSelect
          testid="entity-self"
          label={t('form_entity_self')}
          help={source === 'roles' ? t('form_entity_self_roles_hint') : t('form_entity_self_hint')}
          {t}
          {roles}
          selectedIds={lists.self}
          onchange={(ids) => onlists({ any: [...lists.any], self: ids })}
        />
        <RoleSelect
          testid="entity-any"
          label={t('form_entity_any')}
          help={source === 'roles' ? t('form_entity_any_roles_hint') : t('form_entity_any_hint')}
          {t}
          {roles}
          selectedIds={lists.any}
          onchange={(ids) => onlists({ any: ids, self: [...lists.self] })}
        />
        <p class="summary" data-testid="entity-summary">{summary}</p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button onclick={() => (open = false)} data-testid="entity-done">{t('form_entity_done')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-height: 60dvh;
    padding: 0.5rem 0;
    overflow-y: auto;
  }
  .row {
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem;
    background: color-mix(in oklab, var(--muted) 50%, transparent);
    border-radius: 0.5rem;
  }
  .row-text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .row-text :global(label) {
    font-size: 0.875rem;
    font-weight: 500;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .section :global(label) {
    font-size: 0.875rem;
    font-weight: 500;
  }
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .expr {
    padding: 0.5rem;
    overflow-wrap: anywhere;
    font-size: 0.75rem;
    background: var(--muted);
    border-radius: 0.25rem;
  }
  .summary {
    margin: 0;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    background: color-mix(in oklab, var(--muted) 50%, transparent);
    border-radius: 0.5rem;
  }
</style>
