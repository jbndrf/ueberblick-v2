<script lang="ts">
  // v3's create / edit dialog (`relations/+page.svelte:258-397`): Name, Eltern-Objektart, Kind-Objektart, Multiplizität,
  // Anbindung (with its help line), "Wenn das Eltern-Objekt gelöscht wird", Abbrechen and Erstellen / Speichern, with
  // native selects (they open the phone's own picker), and 'Geometrie beim Erstellen' (WP-396, `:316-329`).
  // v4 writes Anbindung and the delete choice as ordinary tasks and steps (owner A2), so each choice has a help line
  // that says where it shows in the builder. The geometry choice depends on the child type: with a position of its
  // own only 'zeichnen' is valid (shown, disabled); without one, 'übernehmen' (`inherit_position`) or 'keine'. A refusal of the project file (a compile problem) is shown in the dialog,
  // which stays open.
  import { RELATION_CARDINALITIES } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import {
    ATTACHMENT,
    ATTACHMENT_HELP,
    GEOMETRY,
    GEOMETRY_HELP,
    MULTIPLICITY,
    ON_DELETE,
    ON_DELETE_HELP,
    relationLabel,
  } from './labels';
  import type { RelationsPageData, RelationValues, TypeChoice } from './types';

  let {
    open = $bindable(false),
    locale,
    types,
    choices,
    relation,
    geometryProblem = false,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    types: readonly TypeChoice[];
    /** The keys of the two option selects, in registry order. */
    choices: RelationsPageData['choices'];
    /** The relation being edited; null creates a new one. */
    relation: RelationValues | null;
    /** The engine reports `inherit_with_own_geometry` for the relation being edited. */
    geometryProblem?: boolean;
    /** Resolves with the refusal text, or null when it worked (the page closes the dialog). */
    onsave: (values: RelationValues) => Promise<string | null>;
  } = $props();

  const t = (key: AdminKey): string => adminMessage(locale, key);
  const pick = (map: Readonly<Record<string, AdminKey>>, key: string): string =>
    relationLabel(locale, map, key);
  /** v3's defaults of a new relation (`relations/+page.svelte:120-125`): Verbindlich, Kinder trennen. */
  const BLANK: RelationValues = {
    name: '',
    parent: '',
    child: '',
    cardinality: 'many',
    attachment: 'enforced',
    onDelete: 'nullify',
    geometry: 'inherit',
  };
  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none';

  let values = $state<RelationValues>({ ...BLANK });
  let touched = $state(false);
  let refusal = $state<string | null>(null);
  let busy = $state(false);
  const uid = $props.id();
  const sameType = $derived(values.parent !== '' && values.parent === values.child);
  const nameEmpty = $derived(values.name.trim() === '');
  const childHasGeometry = $derived(types.find((c) => c.key === values.child)?.hasGeometry === true);
  /** The engine's problem stays on the select while the relation still draws children at a parent that has its own. */
  const showProblem = $derived(geometryProblem && childHasGeometry && values.geometry === 'inherit');
  const geometryChoices = $derived(
    (childHasGeometry ? (showProblem ? ['inherit', 'draw'] : ['draw']) : ['inherit', 'none']).filter((k) =>
      choices.geometries.includes(k),
    ),
  );
  const incomplete = $derived(values.parent === '' || values.child === '');

  // The child type decides what is valid: its own geometry means zeichnen, none means übernehmen or keine.
  $effect(() => {
    if (!geometryChoices.includes(values.geometry))
      values = { ...values, geometry: geometryChoices[0] ?? 'inherit' };
  });

  // Fresh values each time the dialog opens (v3 `openCreate` / `openEdit`; the default multiplicity is "many").
  $effect(() => {
    if (open) {
      values = relation ?? { ...BLANK };
      touched = false;
      refusal = null;
      busy = false;
    }
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    touched = true;
    if (nameEmpty || incomplete || sameType || busy) return;
    busy = true;
    refusal = await onsave({ ...values });
    busy = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90svh] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{relation ? t('rel_edit') : t('rel_create')}</Dialog.Title>
    </Dialog.Header>
    <form onsubmit={submit} novalidate>
      <div class="grid gap-4 py-4">
        <div class="grid gap-2">
          <Label for="{uid}-name">{t('rel_name')}</Label>
          <Input
            id="{uid}-name"
            bind:value={values.name}
            placeholder={t('rel_name_ph')}
            required
            aria-invalid={touched && nameEmpty ? 'true' : undefined}
          />
          {#if touched && nameEmpty}
            <p role="alert" class="text-sm text-destructive">{t('rel_err_name_empty')}</p>
          {/if}
        </div>

        <div class="grid gap-2">
          <Label for="{uid}-parent">{t('rel_parent')}</Label>
          <select id="{uid}-parent" bind:value={values.parent} required class={selectClass}>
            <option value="" disabled>{t('rel_select_type')}</option>
            {#each types as choice (choice.key)}
              <option value={choice.key}>{choice.label}</option>
            {/each}
          </select>
        </div>

        <div class="grid gap-2">
          <Label for="{uid}-child">{t('rel_child')}</Label>
          <select id="{uid}-child" bind:value={values.child} required class={selectClass}>
            <option value="" disabled>{t('rel_select_type')}</option>
            {#each types as choice (choice.key)}
              <option value={choice.key}>{choice.label}</option>
            {/each}
          </select>
          {#if sameType}
            <p class="text-xs text-destructive">{t('rel_err_same_type')}</p>
          {/if}
        </div>

        <div class="grid gap-2">
          <Label for="{uid}-multiplicity">{t('rel_multiplicity')}</Label>
          <select id="{uid}-multiplicity" bind:value={values.cardinality} class={selectClass}>
            {#each RELATION_CARDINALITIES.keys as key (key)}
              <option value={key}>{pick(MULTIPLICITY, key)}</option>
            {/each}
          </select>
        </div>

        <div class="grid gap-2">
          <Label for="{uid}-attachment">{t('rel_attachment')}</Label>
          <select id="{uid}-attachment" bind:value={values.attachment} class={selectClass}>
            {#each choices.attachments as key (key)}
              <option value={key}>{pick(ATTACHMENT, key)}</option>
            {/each}
          </select>
          <p class="text-xs text-muted-foreground">{pick(ATTACHMENT_HELP, values.attachment)}</p>
        </div>

        <div class="grid gap-2">
          <Label for="{uid}-geometry">{t('rel_geometry')}</Label>
          <select
            id="{uid}-geometry"
            bind:value={values.geometry}
            disabled={geometryChoices.length === 1}
            aria-invalid={showProblem ? 'true' : undefined}
            class={selectClass}
          >
            {#each geometryChoices as key (key)}
              <option value={key}>{pick(GEOMETRY, key)}</option>
            {/each}
          </select>
          {#if showProblem}
            <p role="alert" data-testid="relation-geometry-problem" class="text-sm text-destructive">
              {t('rel_geometry_problem')}
            </p>
          {/if}
          <p class="text-xs text-muted-foreground">{pick(GEOMETRY_HELP, values.geometry)}</p>
        </div>

        <div class="grid gap-2">
          <Label for="{uid}-on-delete">{t('rel_on_delete')}</Label>
          <select id="{uid}-on-delete" bind:value={values.onDelete} class={selectClass}>
            {#each choices.onDelete as key (key)}
              <option value={key}>{pick(ON_DELETE, key)}</option>
            {/each}
          </select>
          <p class="text-xs text-muted-foreground">{pick(ON_DELETE_HELP, values.onDelete)}</p>
        </div>

        {#if refusal}
          <p role="alert" data-testid="relation-refusal" class="text-sm text-destructive">{refusal}</p>
        {/if}
      </div>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('rel_cancel')}</Button>
        <Button type="submit" disabled={sameType || busy}>
          {relation ? t('rel_save') : t('rel_create_action')}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
