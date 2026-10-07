<script lang="ts">
  // "Wer sieht / bearbeitet dieses Feld": the roles that may see and write the property, right where the admin builds
  // the form (the permission matrix is the overview for bulk work). Split from FieldPane (WP-412, R8).
  import type { TemplateFile } from '@ueberblick/core';
  import type { MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import type { Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import type { Translate } from '../../shell/messages';
  import { slugKey } from '../../lenses/data-model/ops';
  import RoleSelect from '../shared/RoleSelect.svelte';
  import { setHiddenOp } from '../model/fields/layout-ops';
  import { propertyAudience, setPropertyRolesOp, type PropertyAction, type PropertyAudience } from './perms';

  interface Props {
    t: Translate;
    file: TemplateFile;
    type: string;
    fieldKey: string;
    locale: string;
    run: (op: Op | undefined) => boolean;
  }
  const { t, file, type, fieldKey: key, locale, run }: Props = $props();

  let createdRole = $state('');

  /** v3's "In Daten-Tabs ausgeblendet" (`display_config.invisible`): the property stays out of the Daten tabs. */
  const hidden = $derived(file.types?.[type]?.properties[key]?.display?.hidden === true);

  const roles = $derived<MultiSelectOption[]>(
    Object.entries(file.roles ?? {}).map(([id, r]) => ({
      value: id,
      label: labelOf(r.label, locale, id),
    })),
  );

  // The audience of one action, as the picker shows it.
  const audience = (action: PropertyAction): PropertyAudience => propertyAudience(file, type, action, key);
  const picked = (a: PropertyAudience): string[] => (a.kind === 'roles' ? [...a.roles] : []);
  const seeAudience = $derived(audience('see'));
  const writeAudience = $derived(audience('write'));

  function setRoles(action: PropertyAction, ids: string[]): void {
    run(setPropertyRolesOp(file, type, action, key, ids));
  }

  /** v3 inline role creation. In v4 a new role is part of the draft and applies after "Veröffentlichen". */
  function createRole(name: string): string | undefined {
    const id = slugKey(name, new Set(Object.keys(file.roles ?? {})));
    const op =
      file.roles === undefined
        ? ({ kind: 'add', path: 'roles', value: { [id]: { label: { [locale]: name } } } } as const)
        : ({ kind: 'add', path: `roles.${id}`, value: { label: { [locale]: name } } } as const);
    if (!run(op)) return undefined;
    createdRole = name;
    return id;
  }
</script>

<RoleSelect
  testid="field-see"
  label={t('field_view_roles')}
  help={seeAudience.kind === 'row' ? t('field_roles_row_hint') : t('field_view_roles_hint')}
  {t}
  {roles}
  selectedIds={picked(seeAudience)}
  disabled={seeAudience.kind === 'row'}
  onchange={(ids) => setRoles('see', ids)}
  oncreate={createRole}
/>
<RoleSelect
  testid="field-write"
  label={t('field_write_roles')}
  help={writeAudience.kind === 'none' ? t('field_roles_none_hint') : t('field_write_roles_hint')}
  placeholder={writeAudience.kind === 'none' ? t('field_roles_none') : t('role_select_placeholder')}
  {t}
  {roles}
  selectedIds={picked(writeAudience)}
  onchange={(ids) => setRoles('write', ids)}
  oncreate={createRole}
/>
<label class="hidden-toggle">
  <input
    type="checkbox"
    data-testid="field-hidden"
    checked={hidden}
    onchange={(e) => run(setHiddenOp(file, type, key, e.currentTarget.checked))}
  />
  {t('field_hidden_from_tabs')}
</label>
{#if createdRole}<p class="note" role="status">{t('field_role_created', { name: createdRole })}</p>{/if}

<style>
  .hidden-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--foreground);
    cursor: pointer;
  }
  .note {
    margin: 0;
    padding: 0.375rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--muted);
    font-size: 0.6875rem;
    color: var(--muted-foreground);
  }
</style>
