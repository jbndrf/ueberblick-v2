<script lang="ts">
  // v3 `form-editor/EntitySelectorConfig.svelte`: "Auswählen aus" as a vertical list of radio cards (Tabelle,
  // Teilnehmende, Rollen: a `role` property, A-051), then one button that opens the
  // configuration dialog with a "Konfiguriert" badge. The source is the property's type, so picking one changes the
  // field's type (a reference or a participant property); the dialog is `EntitySelectorModal.svelte`.
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import type { MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import * as RadioGroup from '@ueberblick/ui/components/ui/radio-group';
  import type { Translate } from '../../shell/messages';
  import type { EntityConfig, EntitySource, TableChoice } from './entity';
  import EntitySelectorModal from './EntitySelectorModal.svelte';

  interface Props {
    t: Translate;
    cfg: EntityConfig;
    tables: readonly TableChoice[];
    roles: readonly MultiSelectOption[];
    onsource: (source: EntitySource) => void;
    ontable: (table: string) => void;
    onmany: (many: boolean) => void;
    ondisplay: (display: string | undefined) => void;
    onsee: (ids: string[]) => void;
    onlists: (lists: { any: string[]; self: string[] }) => void;
  }
  let { t, cfg, tables, roles, onsource, ontable, onmany, ondisplay, onsee, onlists }: Props = $props();

  let modalOpen = $state(false);

  const source = $derived(cfg.source ?? 'table');
  const sourceLabel = $derived(
    source === 'table'
      ? t('form_entity_table')
      : source === 'roles'
        ? t('form_entity_roles')
        : t('form_entity_participants'),
  );
  const configured = $derived(
    cfg.source === 'table'
      ? cfg.table !== undefined
      : cfg.source === 'roles'
        ? cfg.many || cfg.roleSelect.any.length > 0 || cfg.roleSelect.self.length > 0
        : !cfg.constraint.foreign &&
          (cfg.constraint.roles.any.length > 0 || cfg.constraint.roles.self.length > 0),
  );
  const noTables = $derived(tables.length === 0 && cfg.source !== 'table');
</script>

<section class="entity" data-testid="cfg-entity">
  <div class="section">
    <Label>{t('form_entity_select_from')}</Label>
    <RadioGroup.Root
      value={source}
      onValueChange={(v: string) => v !== source && onsource(v as EntitySource)}
      aria-label={t('form_entity_select_from')}
    >
      <div class="list">
        <div class="option" data-testid="entity-source-table">
          <RadioGroup.Item value="table" id="entity-src-table" disabled={noTables} />
          <Label for="entity-src-table">{t('form_entity_table')}</Label>
        </div>
        <div class="option" data-testid="entity-source-participants">
          <RadioGroup.Item value="participants" id="entity-src-participants" />
          <Label for="entity-src-participants">{t('form_entity_participants')}</Label>
        </div>
        <div class="option" data-testid="entity-source-roles">
          <RadioGroup.Item value="roles" id="entity-src-roles" />
          <Label for="entity-src-roles">{t('form_entity_roles')}</Label>
        </div>
      </div>
    </RadioGroup.Root>
    {#if noTables}<p class="hint" data-testid="entity-no-tables">{t('form_entity_no_tables')}</p>{/if}
  </div>

  <div class="section">
    <Button variant="outline" class="wide" onclick={() => (modalOpen = true)} data-testid="entity-configure">
      <Settings2 size={16} />
      {t('form_entity_configure', { source: sourceLabel })}
      {#if configured}<span class="badge" data-testid="entity-configured">{t('form_entity_configured')}</span
        >{/if}
    </Button>
  </div>
</section>

<EntitySelectorModal
  bind:open={modalOpen}
  {t}
  {cfg}
  {source}
  {sourceLabel}
  {tables}
  {roles}
  {ontable}
  {onmany}
  {ondisplay}
  {onsee}
  {onlists}
/>

<style>
  .entity {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .section :global(label) {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
  }
  .option:hover {
    background: var(--accent);
  }
  .option:has(:global([data-state='checked'])) {
    background: color-mix(in oklab, var(--primary) 10%, transparent);
    border-color: color-mix(in oklab, var(--primary) 30%, transparent);
  }
  .option :global(label) {
    flex: 1;
    font-size: 0.8125rem;
    color: var(--foreground);
    cursor: pointer;
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .entity :global(.wide) {
    justify-content: center;
    width: 100%;
    min-height: 2.75rem;
  }
  .badge {
    padding: 0.125rem 0.5rem;
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--primary);
    background: color-mix(in oklab, var(--primary) 10%, transparent);
    border-radius: 9999px;
  }
</style>
