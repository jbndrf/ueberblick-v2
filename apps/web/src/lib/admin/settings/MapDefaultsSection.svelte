<script lang="ts">
  import { untrack } from 'svelte';
  // v3 `settings/sections/MapDefaultsSection.svelte:60-164`: a summary box of the default view (Zoom, Zentrum), the
  // Standard-Zoom field, Min. and Max. Zoom side by side, Zentrum Breitengrad and Längengrad side by side, and one
  // "Standards speichern" button ("Wird gespeichert..." while it works). v4: the values are saved into the draft's
  // `map.start`, `map.min_zoom` and `map.max_zoom`; a value that fails shows its message under the field (v3 only
  // blocked the save), and the same checks run on the server (`validateMapView`).
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import {
    validateMapView,
    ZOOM_MAX,
    ZOOM_MIN,
    type MapViewError,
    type MapViewField,
    type MapViewValues,
  } from './map-view';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';

  let { data, locale, api, reload }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  const shown = (n: number): string => String(n);
  // The fields start from the saved view; after that they hold the person's edit.
  const form = $state<Record<MapViewField, string>>(
    untrack(() => ({
      zoom: shown(data.map.zoom),
      minZoom: shown(data.map.minZoom),
      maxZoom: shown(data.map.maxZoom),
      lat: shown(data.map.lat),
      lng: shown(data.map.lng),
    })),
  );
  let saving = $state(false);
  let errors = $state<readonly MapViewError[]>([]);

  const num = (s: string | number | null): number =>
    s === null || String(s).trim() === '' ? Number.NaN : Number(s);
  const values = (): MapViewValues => ({
    lat: num(form.lat),
    lng: num(form.lng),
    zoom: num(form.zoom),
    minZoom: num(form.minZoom),
    maxZoom: num(form.maxZoom),
  });
  const errorOf = (field: MapViewField): string | null => {
    const e = errors.find((x) => x.field === field);
    return e === undefined ? null : t(`settings_map_err_${e.code}` as AdminKey);
  };

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    errors = validateMapView(values());
    if (errors.length > 0) return;
    saving = true;
    const r = await api.saveMap(values());
    saving = false;
    if (!r.ok) {
      errors = r.fields ?? [];
      return void toast.error(r.message || t('settings_map_save_error'));
    }
    toast.success(t('settings_map_saved'));
    notifyDraftChanged();
    await reload();
  }
</script>

{#snippet field(id: string, field: MapViewField, label: string, step?: string, min?: number, max?: number)}
  {@const message = errorOf(field)}
  <div class="space-y-2">
    <Label for={id}>{label}</Label>
    <Input
      {id}
      name={id}
      type="number"
      {step}
      {min}
      {max}
      bind:value={form[field]}
      aria-invalid={message !== null}
    />
    {#if message}<p class="text-xs text-destructive" role="alert">{message}</p>{/if}
  </div>
{/snippet}

<SettingsSection name={t('settings_map_title')} description={t('settings_map_description')}>
  <div class="rounded-md border bg-muted/30 px-4 py-3 text-sm" data-testid="map-summary">
    <div class="font-medium">{t('settings_map_view_label')}</div>
    <div class="mt-0.5 text-muted-foreground">
      {t('settings_map_zoom_label')}
      {data.map.zoom}, {t('settings_map_center_label')}
      {data.map.lat.toFixed(4)}, {data.map.lng.toFixed(4)}
    </div>
  </div>

  <form onsubmit={save} class="space-y-4" novalidate>
    {@render field('default_zoom', 'zoom', t('settings_map_zoom'), undefined, ZOOM_MIN, ZOOM_MAX)}
    <div class="grid grid-cols-2 gap-4">
      {@render field('min_zoom', 'minZoom', t('settings_map_min_zoom'), undefined, ZOOM_MIN, ZOOM_MAX)}
      {@render field('max_zoom', 'maxZoom', t('settings_map_max_zoom'), undefined, ZOOM_MIN, ZOOM_MAX)}
    </div>
    <div class="grid grid-cols-2 gap-4">
      {@render field('center_lat', 'lat', t('settings_map_lat'), '0.0001', -90, 90)}
      {@render field('center_lng', 'lng', t('settings_map_lng'), '0.0001', -180, 180)}
    </div>
    <div>
      <Button type="submit" disabled={saving}>
        {saving ? t('settings_map_saving') : t('settings_map_save')}
      </Button>
    </div>
  </form>
</SettingsSection>
