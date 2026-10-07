<script lang="ts">
  // v3's preset dialog (`FieldFiltersSection.svelte:328-376`): title "Neues Preset" / "Preset bearbeiten", the Name
  // field, a separator, "Filterbedingungen" with the filter builder, and Abbrechen / Speichern. The builder is the
  // participant's (v3 imported the participant's `FilterBuilder` too). v4 keeps a preset per role, so the dialog adds one
  // field v3 had no use for: "Gilt für Rollen" (all roles ticked at first, so v3's single project-wide preset is one
  // tap); the builder offers the fields those roles can read.
  import { untrack } from 'svelte';
  import type { Clause } from '@ueberblick/core/filters';
  import type { CompiledConfig } from '@ueberblick/core/hydrate';
  import type { Key } from '@ueberblick/core/model';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Separator } from '@ueberblick/ui/components/ui/separator';
  import FilterBuilder from '../../participant/sheets/filter/builder/FilterBuilder.svelte';
  import { builderPort } from '../../participant/sheets/filter/builder/port';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { PresetRow, PresetSave, RoleOption } from './presets-types';

  let {
    open = $bindable(false),
    locale,
    config,
    roles,
    editing,
    saving,
    error,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    /** The compiled draft the builder offers its types, fields and stages from. */
    config: CompiledConfig;
    roles: readonly RoleOption[];
    /** The preset being edited; null for a new one. */
    editing: PresetRow | null;
    saving: boolean;
    /** A refusal of the last save, shown under the buttons. */
    error: string | null;
    onsave: (preset: PresetSave) => void | Promise<void>;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  let name = $state('');
  let chosen = $state<readonly string[]>([]);
  let clauses = $state<readonly Clause[]>([]);
  let nameMissing = $state(false);
  const uid = $props.id();

  // The builder offers what the chosen roles can read (fields the actor may not read are not offered).
  const port = $derived(
    builderPort({
      config,
      actor: { id: 'admin', kind: 'participant', roles: chosen.map((r) => r as Key) },
      locale,
      features: () => [],
      nameOf: () => undefined,
      unknown: '',
    }),
  );

  // Fresh values each time the dialog opens (v3 `openNewPreset` / `openEditPreset`).
  $effect(() => {
    if (!open) return;
    untrack(() => {
      name = editing?.label ?? '';
      chosen = editing?.roles ?? roles.map((r) => r.key);
      clauses = editing === null ? [] : port.read(editing.filters);
      nameMissing = false;
    });
  });

  function toggle(key: string, on: boolean): void {
    chosen = on ? [...chosen, key] : chosen.filter((k) => k !== key);
  }

  function commit(event: SubmitEvent): void {
    event.preventDefault();
    nameMissing = name.trim() === '';
    if (nameMissing) return;
    void onsave({
      name: name.trim(),
      roles: roles.map((r) => r.key).filter((k) => chosen.includes(k)),
      filters: port.write(clauses),
      ...(editing === null ? {} : { key: editing.key, was: editing.roles }),
    });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl" data-testid="preset-dialog">
    <Dialog.Header>
      <Dialog.Title>{editing ? t('settings_preset_edit_title') : t('settings_preset_new_title')}</Dialog.Title
      >
    </Dialog.Header>
    <form onsubmit={commit} class="flex flex-col gap-4" novalidate>
      <div class="flex flex-col gap-1">
        <Label for="{uid}-name">{t('settings_preset_name')}</Label>
        <Input
          id="{uid}-name"
          bind:value={name}
          placeholder={t('settings_preset_name_ph')}
          aria-invalid={nameMissing ? 'true' : undefined}
        />
        {#if nameMissing}
          <p role="alert" class="text-sm text-destructive">{t('settings_err_name_missing')}</p>
        {/if}
      </div>
      <fieldset class="flex flex-col gap-1">
        <legend class="mb-1 text-sm font-medium">{t('settings_preset_roles_label')}</legend>
        {#each roles as r (r.key)}
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={chosen.includes(r.key)}
              onchange={(e) => toggle(r.key, e.currentTarget.checked)}
            />
            {r.label}
          </label>
        {/each}
        {#if chosen.length === 0}
          <p role="alert" class="text-sm text-destructive">{t('settings_err_roles_missing')}</p>
        {/if}
      </fieldset>
      <Separator />
      <div class="flex flex-col gap-2">
        <Label>{t('settings_preset_conditions_label')}</Label>
        <FilterBuilder {port} {clauses} {locale} onchange={(next) => (clauses = next)} />
      </div>
      {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>
          {t('settings_preset_cancel')}
        </Button>
        <Button type="submit" disabled={saving || chosen.length === 0}>
          {saving ? t('settings_preset_saving') : t('settings_preset_save')}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
