<script lang="ts">
  // v3's type pill, geometry pill and "Private Einträge" switch of the data page header (`+page.svelte:921-1000`, the
  // pills' tooltips `:646`). The type pill says whether the Objektart lives on the map or is a form (v3 "Vorfall-/Umfrage-
  // Workflow": here `types.<t>.geometry` set or not); the geometry pill picks the shape (Punkt, Linie, Fläche). v3 locked both
  // once objects existed; here the change goes to the draft and the deploy overview names the affected objects (register
  // row 81), so the lock hint is the pills' tooltip and a note. The "Aktiv/Inaktiv" switch is not ported (register row 82).
  import Check from '@lucide/svelte/icons/check';
  import Hexagon from '@lucide/svelte/icons/hexagon';
  import MapPin from '@lucide/svelte/icons/map-pin';
  import Spline from '@lucide/svelte/icons/spline';
  import type { GeometryTypeKey } from '@ueberblick/core';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import { HEADER_GEOMETRIES, type HeaderCall, type HeaderResult, type HeaderState } from './header-types';

  let {
    locale,
    header,
    onCall,
    onShape,
  }: {
    locale: Locale;
    header: HeaderState;
    onCall: (call: HeaderCall) => Promise<HeaderResult>;
    /** The shape changed in the draft: the header shows its note. */
    onShape: () => void;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const shape = $derived(header.shape);
  const geometryLabel = (kind: GeometryTypeKey): string => t(`data_geom_${kind}` as AdminKey);
  // v3's lock title, as a hint: with objects the change waits for the deploy overview.
  const locked = $derived(header.featureCount > 0);

  async function send(call: HeaderCall, shaped: boolean): Promise<void> {
    const r = await onCall(call);
    if (!r.ok) toast.error(r.message || t('data_header_failed'));
    else if (shaped) onShape();
  }
  const kinds = $derived(
    shape?.kind !== undefined && !HEADER_GEOMETRIES.includes(shape.kind)
      ? [shape.kind, ...HEADER_GEOMETRIES]
      : HEADER_GEOMETRIES,
  );
</script>

{#if shape}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <button
          type="button"
          {...props}
          class="inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold transition-colors hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none {shape.map
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground'}"
          title={locked ? t('data_shape_note', { count: header.featureCount }) : t('data_type_help')}
          data-testid="data-type-pill"
        >
          {#if shape.map}<MapPin class="mr-1 h-3 w-3" />{/if}
          {shape.map ? t('data_type_map') : t('data_type_form')}
        </button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start">
      {#each [true, false] as map (map)}
        <DropdownMenu.Item
          onclick={() => shape.map !== map && void send({ action: 'map', on: map }, true)}
          data-testid={map ? 'data-type-map' : 'data-type-form'}
        >
          {#if shape.map === map}<Check class="mr-2 h-4 w-4" />{:else}<span class="mr-2 inline-block h-4 w-4"
            ></span>{/if}
          {map ? t('data_type_map') : t('data_type_form')}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  {#if shape.map}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button
            type="button"
            {...props}
            class="inline-flex items-center rounded-md bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground transition-colors hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            title={locked ? t('data_shape_note', { count: header.featureCount }) : t('data_geom_help')}
            data-testid="data-geometry-pill"
          >
            {#if shape.kind === 'linestring' || shape.kind === 'multilinestring'}
              <Spline class="mr-1 h-3 w-3" />
            {:else if shape.kind === 'polygon' || shape.kind === 'multipolygon'}
              <Hexagon class="mr-1 h-3 w-3" />
            {:else}
              <MapPin class="mr-1 h-3 w-3" />
            {/if}
            {shape.kind === undefined ? t('data_geom_any') : geometryLabel(shape.kind)}
          </button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        {#each kinds as kind (kind)}
          <DropdownMenu.Item
            onclick={() => shape.kind !== kind && void send({ action: 'geometry', kind }, true)}
            data-testid={`data-geometry-${kind}`}
          >
            {#if shape.kind === kind}<Check class="mr-2 h-4 w-4" />{:else}<span
                class="mr-2 inline-block h-4 w-4"
              ></span>{/if}
            {geometryLabel(kind)}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}
{/if}

<div class="flex items-center gap-2 text-sm" title={t('data_private_help')}>
  <span class="text-muted-foreground">{t('data_private')}</span>
  <Switch
    checked={header.private === 'on'}
    disabled={header.private === 'custom'}
    onCheckedChange={(on) => void send({ action: 'private', on }, false)}
    aria-label={t('data_private')}
    data-testid="data-private"
  />
</div>
