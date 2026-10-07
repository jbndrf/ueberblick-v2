<script lang="ts">
  // v3 `OfflinePacksSection.svelte:295-505`: the "Offline-Paket erstellen" dialog (90vh, max-w-2xl, the body scrolls):
  // Paketname, Min./Max. Zoom side by side, Region (a button that opens the region map; once a region exists a box with
  // its area, the tile estimate and "Region bearbeiten"), the layers as checkboxes with a "Basis" badge (all are on when
  // it opens), "Sichtbar für Rollen" as v3's multi select (empty means all roles) and Abbrechen / "Paket erstellen". The
  // checks and their order are v3's (region, name, layer); the zoom range and the size limit are the file's own checks.
  import { untrack } from 'svelte';
  import Loader2 from '@lucide/svelte/icons/loader-circle';
  import MapPin from '@lucide/svelte/icons/map-pin';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { packLimit } from '@ueberblick/core/registry/admin';
  import type { Bounds } from '@ueberblick/core/geo';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { MultiSelect } from '@ueberblick/ui/components/ui/multi-select';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import {
    PACK_FORM_DEFAULTS,
    boundsAreaKm2,
    estimateOf,
    formatArea,
    formatTileCount,
    packProblem,
    type PackProblem,
    type PackValues,
  } from './packs';
  import RegionSelector from './RegionSelector.svelte';
  import type { SettingsDocData } from './types';
  import type { TemplateFile } from '@ueberblick/core';

  let {
    open = $bindable(false),
    locale,
    data,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    data: SettingsDocData;
    onsave: (values: PackValues) => void | Promise<void>;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  let name = $state('');
  let minZoom = $state(String(PACK_FORM_DEFAULTS.minZoom));
  let maxZoom = $state(String(PACK_FORM_DEFAULTS.maxZoom));
  let bounds = $state<Bounds | null>(null);
  let layers = $state<string[]>([]);
  let roles = $state<string[]>([]);
  let creating = $state(false);
  let regionOpen = $state(false);

  // The estimate reads only the layers and the roles of the file, which the page data carries.
  const file = $derived({ map: data.mapConfig ?? undefined } as unknown as TemplateFile);
  const values = $derived({
    name,
    minZoom: Number(minZoom),
    maxZoom: Number(maxZoom),
    bounds,
    layers,
    roles,
  });
  const estimate = $derived(
    bounds === null
      ? null
      : estimateOf(file, { bounds, minZoom: Number(minZoom), maxZoom: Number(maxZoom), layers }),
  );
  const options = $derived(
    data.roles.map((r) => ({ value: r.key, label: r.label, description: r.description })),
  );

  // Fresh each time it opens: v3's defaults, every layer a pack can hold switched on.
  $effect(() => {
    if (open)
      untrack(() => {
        name = '';
        minZoom = String(PACK_FORM_DEFAULTS.minZoom);
        maxZoom = String(PACK_FORM_DEFAULTS.maxZoom);
        bounds = null;
        layers = data.packLayers.filter((l) => l.packable).map((l) => l.key);
        roles = [];
        creating = false;
      });
  });

  const REFUSAL: Record<PackProblem, AdminKey> = {
    region: 'pack_region_required',
    name: 'pack_name_required',
    layers: 'pack_layer_required',
    zoom: 'pack_zoom_invalid',
    too_large: 'pack_too_large',
  };

  async function create(): Promise<void> {
    const problem = packProblem(values, file);
    if (problem !== null || bounds === null) return void toast.error(t(REFUSAL[problem ?? 'region']));
    creating = true;
    try {
      await onsave({ name, minZoom: values.minZoom, maxZoom: values.maxZoom, bounds, layers, roles });
    } finally {
      creating = false;
    }
  }

  const toggle = (key: string, on: boolean): void => {
    layers = on ? [...layers, key] : layers.filter((k) => k !== key);
  };
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[90vh] max-w-2xl flex-col sm:max-w-2xl" data-testid="pack-dialog">
    <Dialog.Header class="shrink-0">
      <Dialog.Title>{t('pack_dialog_title')}</Dialog.Title>
      <Dialog.Description>{t('pack_dialog_description')}</Dialog.Description>
    </Dialog.Header>
    <div class="grid flex-1 gap-4 overflow-y-auto py-4 pr-2">
      <div class="grid gap-2">
        <Label for="pack_name">{t('pack_name_label')}</Label>
        <Input id="pack_name" bind:value={name} placeholder={t('pack_name_ph')} required />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="grid gap-2">
          <Label for="pack_zoom_min">{t('pack_min_zoom')}</Label>
          <Input
            id="pack_zoom_min"
            type="number"
            min={packLimit('min_zoom')}
            max={packLimit('max_zoom')}
            bind:value={minZoom}
          />
        </div>
        <div class="grid gap-2">
          <Label for="pack_zoom_max">{t('pack_max_zoom')}</Label>
          <Input
            id="pack_zoom_max"
            type="number"
            min={packLimit('min_zoom')}
            max={packLimit('max_zoom')}
            bind:value={maxZoom}
          />
        </div>
      </div>

      <div class="grid gap-2">
        <Label>{t('pack_region_label')}</Label>
        {#if bounds !== null && estimate !== null}
          <div
            class="flex items-center justify-between gap-2 rounded-md border bg-muted/50 p-3"
            data-testid="pack-region"
          >
            <div class="flex items-center gap-2">
              <MapPin class="h-4 w-4 text-muted-foreground" />
              <div>
                <div class="text-sm font-medium">{formatArea(boundsAreaKm2(bounds))}</div>
                <div class="text-xs text-muted-foreground">
                  {formatTileCount(estimate.tiles)}
                  {t('region_tiles')}
                  {minZoom}-{maxZoom}
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onclick={() => (regionOpen = true)}>
              <Pencil class="mr-1 h-4 w-4" />
              {t('pack_edit_region')}
            </Button>
          </div>
        {:else}
          <Button
            variant="outline"
            class="h-auto w-full justify-start py-4"
            onclick={() => (regionOpen = true)}
          >
            <MapPin class="mr-2 h-5 w-5 text-muted-foreground" />
            <div class="text-left">
              <div class="font-medium">{t('pack_draw_region')}</div>
              <div class="text-xs text-muted-foreground">{t('pack_draw_region_hint')}</div>
            </div>
          </Button>
        {/if}
      </div>

      <div class="grid gap-2">
        <Label>{t('pack_layers_label')}</Label>
        <div class="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
          {#each data.packLayers as layer (layer.key)}
            <label class="flex items-center gap-2 {layer.packable ? 'cursor-pointer' : 'opacity-60'}">
              <input
                type="checkbox"
                class="h-4 w-4 rounded border-gray-300"
                checked={layers.includes(layer.key)}
                disabled={!layer.packable}
                onchange={(e) => toggle(layer.key, e.currentTarget.checked)}
              />
              <span class="text-sm">{layer.label}</span>
              {#if layer.base}<Badge variant="outline" class="text-xs">{t('pack_base_badge')}</Badge>{/if}
              {#if !layer.packable}<span class="text-xs text-muted-foreground">{t('pack_not_packable')}</span
                >{/if}
            </label>
          {/each}
        </div>
      </div>

      <div class="grid gap-2">
        <Label>{t('pack_roles_label')}</Label>
        <MultiSelect
          disablePortal
          bind:selected={roles}
          {options}
          labels={{ placeholder: t('pack_roles_ph') }}
        />
        <p class="text-xs text-muted-foreground">{t('pack_roles_help')}</p>
      </div>
    </div>

    <Dialog.Footer class="shrink-0">
      <Button type="button" variant="outline" onclick={() => (open = false)}>{t('pack_cancel')}</Button>
      <Button onclick={() => void create()} disabled={creating}>
        {#if creating}
          <Loader2 class="mr-2 h-4 w-4 animate-spin" />
          {t('pack_creating')}
        {:else}
          {t('pack_create')}
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<RegionSelector
  bind:open={regionOpen}
  {locale}
  mapConfig={data.mapConfig}
  start={data.map}
  initial={bounds}
  estimateTiles={(b) =>
    estimateOf(file, { bounds: b, minZoom: Number(minZoom), maxZoom: Number(maxZoom), layers }).tiles}
  onconfirm={(b) => {
    bounds = b;
    regionOpen = false;
  }}
/>
