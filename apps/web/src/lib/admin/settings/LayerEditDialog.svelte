<script lang="ts">
  // The edit dialog of a layer (WP-385 Goal: "edit URL and attribution, order, roles, default base"). v3 changed a layer
  // only through the table (name, opacity slider and roles in Bearbeitungsmodus, "Als Basis/Overlay setzen"); its URL
  // and Quellenangabe could not be changed after adding. This dialog is opened from the row menu ("Bearbeiten", as on the
  // Rollen page) and shows every setting of the layer: Name, Art (Basis/Overlay), the source's fields, Quellenangabe,
  // Deckkraft as v3's slider with its percentage, zoom range, the roles that see it (empty: all) and "beim Start an".
  import { untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { MultiSelect } from '@ueberblick/ui/components/ui/multi-select';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import LayerSourceFields from './LayerSourceFields.svelte';
  import { emptyForm, formOf, patchOf, sourceOf, type LayerFormValues } from './layers-forms';
  import { validateLayerDraft, type LayerPatch, type LayerRowData, type RoleOption } from './layers-model';

  let {
    open = $bindable(false),
    locale,
    row,
    roles,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    row: LayerRowData | null;
    roles: readonly RoleOption[];
    /** Saves the change; true when it worked (the dialog then closes). */
    onsave: (key: string, patch: LayerPatch) => Promise<boolean>;
  } = $props();

  const t = (key: AdminKey): string => adminMessage(locale, key);
  const uid = $props.id();
  let form = $state<LayerFormValues>(emptyForm());
  let busy = $state(false);
  let problem = $state<AdminKey | null>(null);

  // Fresh values each time the dialog opens for a layer.
  $effect(() => {
    if (open && row)
      untrack(() => {
        form = formOf(row);
        problem = null;
      });
  });

  const sourceType = $derived(row && row.type !== 'preset' ? row.type : null);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (row === null) return;
    const lo = form.minzoom.trim() === '' ? undefined : Number(form.minzoom);
    const hi = form.maxzoom.trim() === '' ? undefined : Number(form.maxzoom);
    const bad = validateLayerDraft({
      label: form.name,
      kind: form.kind,
      source: sourceType === null ? row.source : sourceOf(sourceType, form),
      minzoom: lo,
      maxzoom: hi,
    });
    problem = bad === null ? null : (`settings_layers_err_${bad}` as AdminKey);
    if (bad !== null) return;
    busy = true;
    const done = await onsave(row.key, patchOf(row, form));
    busy = false;
    if (done) open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[90vh] max-w-2xl flex-col" data-testid="layer-edit-dialog">
    <Dialog.Header class="shrink-0">
      <Dialog.Title>{t('settings_layers_edit_title')}</Dialog.Title>
      <Dialog.Description>{t('settings_layers_edit_description')}</Dialog.Description>
    </Dialog.Header>
    <form class="flex min-h-0 flex-1 flex-col gap-4" onsubmit={submit} novalidate>
      <div class="flex-1 space-y-4 overflow-y-auto pr-2">
        <div class="space-y-2">
          <Label for="{uid}-name">{t('settings_layers_field_name')}</Label>
          <Input id="{uid}-name" bind:value={form.name} required />
        </div>
        <div class="space-y-2">
          <Label>{t('settings_layers_kind')}</Label>
          <div class="flex gap-2" role="group" aria-label={t('settings_layers_kind')}>
            {#each [['base', 'settings_layers_kind_base'], ['overlay', 'settings_layers_kind_overlay']] as const as [k, label] (k)}
              <Button
                type="button"
                variant={form.kind === k ? 'default' : 'outline'}
                size="sm"
                aria-pressed={form.kind === k}
                onclick={() => (form.kind = k)}>{t(label)}</Button
              >
            {/each}
          </div>
        </div>
        {#if sourceType}
          <LayerSourceFields type={sourceType} bind:form {locale} id={uid} />
          <div class="space-y-2">
            <Label for="{uid}-attribution">{t('settings_layers_attribution_optional')}</Label>
            <Input id="{uid}-attribution" bind:value={form.attribution} />
          </div>
        {:else}
          <p class="text-sm text-muted-foreground">{t('settings_layers_preset_fixed')}</p>
        {/if}
        <div class="space-y-2">
          <Label for="{uid}-opacity">{t('settings_layers_opacity')}</Label>
          <div class="flex items-center gap-3">
            <input
              id="{uid}-opacity"
              type="range"
              min="0"
              max="100"
              step="1"
              bind:value={form.opacity}
              class="h-2 w-full max-w-xs cursor-pointer accent-primary"
            />
            <span class="w-10 text-xs text-muted-foreground tabular-nums">{form.opacity}%</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <Label for="{uid}-minzoom">{t('settings_layers_minzoom')}</Label>
            <Input id="{uid}-minzoom" inputmode="numeric" bind:value={form.minzoom} />
          </div>
          <div class="space-y-2">
            <Label for="{uid}-maxzoom">{t('settings_layers_maxzoom')}</Label>
            <Input id="{uid}-maxzoom" inputmode="numeric" bind:value={form.maxzoom} />
          </div>
        </div>
        <div class="space-y-2">
          <Label for="{uid}-roles">{t('settings_layers_col_roles')}</Label>
          <MultiSelect
            id="{uid}-roles"
            options={roles.map((r) => ({ value: r.key, label: r.label }))}
            bind:selected={form.roles}
          />
          <p class="text-xs text-muted-foreground">{t('settings_layers_roles_hint')}</p>
        </div>
        <div class="flex items-center space-x-2">
          <Switch id="{uid}-start" bind:checked={form.onAtStart} />
          <Label for="{uid}-start">
            {form.kind === 'base' ? t('settings_layers_start_base') : t('settings_layers_start_overlay')}
          </Label>
        </div>
        {#if problem}<p class="text-sm text-destructive" role="alert">{t(problem)}</p>{/if}
      </div>
      <Dialog.Footer class="shrink-0">
        <Button type="button" variant="outline" onclick={() => (open = false)}
          >{t('settings_layers_cancel')}</Button
        >
        <Button type="submit" disabled={busy}
          >{busy ? t('settings_layers_saving') : t('settings_layers_save')}</Button
        >
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
