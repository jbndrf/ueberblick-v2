<script lang="ts">
  // The fields of one source type, shared by the add dialog's tabs and the edit dialog. v3 `LayersSection.svelte:437-532`
  // had them twice (the Kachel-URL tab and the WMS tab): URL template with its z/x/y hint; WMS-URL, Layers, Format,
  // Version, Transparent. v4 adds the PMTiles and GeoJSON sources (registry `MAP_SOURCE_TYPES`). Version and the
  // PMTiles content are button groups like v3's tile-format buttons: a free text would allow values the file refuses.
  import type { MapSourceType } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { LayerFormValues } from './layers-forms';

  let {
    type,
    form = $bindable(),
    locale,
    id,
  }: {
    type: Exclude<MapSourceType, 'preset'>;
    form: LayerFormValues;
    locale: Locale;
    /** Prefix of the field ids, so two forms on one page keep their labels apart. */
    id: string;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);
  const URL_LABEL: Record<typeof type, AdminKey> = {
    xyz: 'settings_layers_tile_url_template',
    wms: 'settings_layers_wms_url',
    pmtiles: 'settings_layers_pmtiles_url',
    geojson: 'settings_layers_geojson_url',
  };
  const URL_HINT: Partial<Record<typeof type, AdminKey>> = {
    xyz: 'settings_layers_tile_placeholder_hint',
    pmtiles: 'settings_layers_pmtiles_hint',
    geojson: 'settings_layers_url_hint',
    wms: 'settings_layers_url_hint',
  };
  const URL_PLACEHOLDER: Record<typeof type, string> = {
    xyz: 'https://example.com/{z}/{x}/{y}.png',
    wms: 'https://example.com/wms',
    pmtiles: '/tiles/stadt.pmtiles',
    geojson: 'https://example.com/daten.geojson',
  };
  const hint = $derived(URL_HINT[type]);
</script>

<div class="space-y-2">
  <Label for="{id}-url">{t(URL_LABEL[type])}</Label>
  <Input
    id="{id}-url"
    bind:value={form.url}
    placeholder={URL_PLACEHOLDER[type]}
    inputmode="url"
    autocapitalize="off"
    required
  />
  {#if hint}<p class="text-xs text-muted-foreground">{t(hint)}</p>{/if}
</div>

{#if type === 'wms'}
  <div class="space-y-2">
    <Label for="{id}-layers">{t('settings_layers_wms_layers')}</Label>
    <Input id="{id}-layers" bind:value={form.wmsLayers} placeholder="layer_name" required />
    <p class="text-xs text-muted-foreground">{t('settings_layers_wms_layers_hint')}</p>
  </div>
  <div class="grid grid-cols-2 gap-4">
    <div class="space-y-2">
      <Label for="{id}-format">{t('settings_layers_format')}</Label>
      <Input id="{id}-format" bind:value={form.format} />
    </div>
    <div class="space-y-2">
      <Label>{t('settings_layers_version')}</Label>
      <div class="flex gap-2" role="group" aria-label={t('settings_layers_version')}>
        {#each ['1.1.1', '1.3.0'] as const as v (v)}
          <Button
            type="button"
            variant={form.version === v ? 'default' : 'outline'}
            size="sm"
            aria-pressed={form.version === v}
            onclick={() => (form.version = v)}>{v}</Button
          >
        {/each}
      </div>
    </div>
  </div>
  <div class="flex items-center space-x-2">
    <Switch id="{id}-transparent" bind:checked={form.transparent} />
    <Label for="{id}-transparent">{t('settings_layers_transparent')}</Label>
  </div>
{/if}

{#if type === 'pmtiles'}
  <div class="space-y-2">
    <Label>{t('settings_layers_pmtiles_content')}</Label>
    <div class="flex gap-2" role="group" aria-label={t('settings_layers_pmtiles_content')}>
      {#each [['raster', 'settings_layers_raster'], ['vector', 'settings_layers_vector']] as const as [v, label] (v)}
        <Button
          type="button"
          variant={form.tileType === v ? 'default' : 'outline'}
          size="sm"
          aria-pressed={form.tileType === v}
          onclick={() => (form.tileType = v)}>{t(label)}</Button
        >
      {/each}
    </div>
  </div>
  {#if form.tileType === 'vector'}
    <div class="space-y-2">
      <Label for="{id}-source-layer">{t('settings_layers_source_layer')}</Label>
      <Input id="{id}-source-layer" bind:value={form.sourceLayer} required />
      <p class="text-xs text-muted-foreground">{t('settings_layers_source_layer_hint')}</p>
    </div>
  {/if}
{/if}
