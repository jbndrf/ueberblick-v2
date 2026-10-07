<script lang="ts">
  // v3 `SharedSidebar.svelte:99-142` (the `workflow` pane, opened by the toolbar's gear): the Objektart's own settings
  // in the right pane. The name, "Sichtbar für Rollen" (with inline role creation), "Private Einträge" and the entry
  // "Standardfilter & Marker-Symbole". Every control is the op of its other place (`ops.ts`, R1): the data page header
  // and the permission matrix write the same ones. The default filter and the marker icons are a link to the data page,
  // where the icon designer is, not a second editor.
  import Tag from '@lucide/svelte/icons/tag';
  import type { MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { labelOf } from '../../shell/location';
  import { getBuilderContext } from '../shell/context';
  import RoleSelect from '../shared/RoleSelect.svelte';
  import { createRoleOps, privateOp, privateState, renameOp, visibleRoles, visibleRolesOp } from './ops';

  const ctx = getBuilderContext();
  const t = ctx.t;

  const file = $derived(ctx.doc().effective());
  const name = $derived(labelOf(file.types?.[ctx.type]?.label, ctx.locale, ctx.type));
  const roles = $derived<MultiSelectOption[]>(
    Object.entries(file.roles ?? {}).map(([id, r]) => ({
      value: id,
      label: labelOf(r.label, ctx.locale, id),
    })),
  );
  const visible = $derived(visibleRoles(file, ctx.type));
  const priv = $derived(privateState(file, ctx.type));
  let createdRole = $state('');

  function commitName(event: Event & { currentTarget: HTMLInputElement }): void {
    const op = renameOp(file, ctx.type, ctx.locale, event.currentTarget.value);
    if (op === undefined || ctx.apply(op).refused !== undefined) event.currentTarget.value = name;
  }

  function setRoles(ids: string[]): void {
    const op = visibleRolesOp(file, ctx.type, ids);
    if (op !== undefined) ctx.apply(op);
  }

  /** v3 `onCreateRole`: the role joins the draft and applies after "Veröffentlichen". */
  function createRole(roleName: string): string | undefined {
    const made = createRoleOps(file, ctx.locale, roleName);
    for (const op of made.ops) if (ctx.apply(op).refused !== undefined) return undefined;
    createdRole = roleName;
    return made.key;
  }

  function setPrivate(on: boolean): void {
    const op = privateOp(ctx.doc(), ctx.type, on);
    if (op !== undefined) ctx.apply(op);
  }
</script>

<div class="pane" data-testid="type-settings-pane">
  <h3 class="title">{t('frame_type_settings')}</h3>

  <label class="field">
    <span>{t('type_settings_name')}</span>
    <Input value={name} onchange={commitName} data-testid="type-settings-name" />
  </label>

  <h4 class="subtitle">{t('type_settings_visibility')}</h4>
  {#if visible === undefined}
    <p class="hint" data-testid="type-visible">{t('type_settings_per_property')}</p>
  {:else}
    <RoleSelect
      testid="type-visible"
      label={t('type_settings_visible_to')}
      help={t('type_settings_visible_hint')}
      {t}
      {roles}
      selectedIds={visible}
      onchange={setRoles}
      oncreate={createRole}
    />
    {#if createdRole}<p class="note" role="status">{t('field_role_created', { name: createdRole })}</p>{/if}
  {/if}

  <label class="check-row">
    <Checkbox
      checked={priv === 'on'}
      disabled={priv === 'custom'}
      onCheckedChange={(on: boolean) => setPrivate(on)}
      aria-label={t('type_settings_private')}
      data-testid="type-private"
    />
    <span class="check-text">
      <span class="check-label">{t('type_settings_private')}</span>
      <span class="hint"
        >{priv === 'custom' ? t('type_settings_private_custom') : t('type_settings_private_hint')}</span
      >
    </span>
  </label>

  {#if ctx.links.icons !== undefined}
    <a class="link" href={ctx.links.icons} data-testid="type-default-filter">
      <Tag class="tag" />
      <span class="link-text">
        <span class="check-label">{t('type_settings_default_filter')}</span>
        <span class="hint">{t('type_settings_default_filter_hint')}</span>
      </span>
    </a>
  {/if}
</div>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
  }
  .title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .subtitle {
    margin: 0.25rem 0 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--muted-foreground);
  }
  .check-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    cursor: pointer;
  }
  .check-text,
  .link-text {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }
  .check-label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--foreground);
  }
  .hint {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .note {
    margin: 0;
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--muted);
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
  .link {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    min-height: 2.25rem;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    text-decoration: none;
    color: var(--foreground);
  }
  .link:hover,
  .link:focus-visible {
    background: var(--muted);
    outline: none;
  }
  .link :global(.tag) {
    width: 0.875rem;
    height: 0.875rem;
    margin-top: 0.125rem;
    color: #f59e0b;
    flex-shrink: 0;
  }
</style>
