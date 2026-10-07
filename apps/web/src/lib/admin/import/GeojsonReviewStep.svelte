<script lang="ts">
  // Step 2 'Prüfen' (v3 `geojson-import-dialog.svelte:221-275`): the name, the line "{n} Features — Geometrietyp: …"
  // and one row per property with the inferred field type and a native select to override it (v3's `<select>`, so a phone
  // shows its own picker). The footer's 'Importieren' is 'Veröffentlichen und importieren' here (nothing is live before
  // the first publish, owner A4), with CSV's amber box saying so.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { IMPORT_COLUMN_TYPES, type GeoGeometryType, type ImportColumnType } from '@ueberblick/core';
  import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { PropertyRow } from './geojson-read';
  import { SELECT_CLASS, type T } from './i18n';
  import type { PublishFailure } from './publish-failure';

  let {
    t,
    name = $bindable(''),
    rows = $bindable([]),
    featureCount,
    kinds,
    busy,
    locked,
    failure,
    onback,
    onimport,
  }: {
    t: T;
    name?: string;
    rows?: PropertyRow[];
    featureCount: number;
    kinds: readonly GeoGeometryType[];
    /** The draft is being written, published or the job is starting. */
    busy: boolean;
    /** The type is already in the draft (a retry after a publish problem): nothing can change any more. */
    locked: boolean;
    failure: PublishFailure | null;
    onback: () => void;
    onimport: () => void;
  } = $props();

  const geometry = $derived(
    kinds.length === 0
      ? t('import_geojson_geometry_none')
      : kinds.length === 1
        ? (kinds[0] ?? '')
        : t('import_geojson_geometry_mixed', { kinds: kinds.join(', ') }),
  );
  const typeLabel = (key: ImportColumnType): string => t(`import_geojson_type_${key}` as AdminKey);
</script>

<div class="space-y-4 py-4">
  <div class="space-y-2">
    <Label for="geojson-name">{t('import_geojson_name_label')}</Label>
    <Input id="geojson-name" bind:value={name} disabled={busy || locked} data-testid="geojson-name" />
  </div>

  <p class="text-sm text-muted-foreground" data-testid="geojson-summary">
    {t('import_geojson_feature_count', { count: featureCount })} — {t('import_geojson_geometry_type')}: {geometry}
  </p>

  {#if rows.length > 0}
    <div class="overflow-x-auto rounded-md border">
      <table class="w-full text-sm" data-testid="geojson-properties">
        <thead>
          <tr class="border-b bg-muted/50">
            <th class="p-2 text-left font-medium whitespace-nowrap">{t('import_geojson_property_column')}</th>
            <th class="p-2 text-left font-medium whitespace-nowrap">{t('import_geojson_type_column')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row, i (row.name)}
            <tr class="border-b last:border-0">
              <td class="p-2 font-mono text-xs whitespace-nowrap">{row.name}</td>
              <td class="p-2">
                <select
                  class="{SELECT_CLASS} min-w-[140px] py-1.5"
                  aria-label="{t('import_geojson_type_column')}: {row.name}"
                  data-testid="geojson-type-{i}"
                  disabled={busy || locked}
                  value={row.selected}
                  onchange={(e) => (row.selected = (e.target as HTMLSelectElement).value as ImportColumnType)}
                >
                  {#each IMPORT_COLUMN_TYPES.keys as type (type)}
                    <option value={type}>{typeLabel(type)}</option>
                  {/each}
                </select>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="text-sm text-muted-foreground">{t('import_geojson_no_properties')}</p>
  {/if}

  <div
    class="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
    data-testid="geojson-unpublished"
  >
    <p class="text-sm font-medium text-amber-800 dark:text-amber-300">{t('import_unpublished_title')}</p>
    <p class="text-xs text-amber-900 dark:text-amber-200">{t('import_geojson_unpublished_body')}</p>
  </div>

  {#if failure}
    <p role="alert" class="flex flex-wrap items-center gap-x-2 text-sm text-destructive">
      {failure.text}
      {#if failure.href}<a class="underline" href={failure.href}>{failure.hrefLabel}</a>{/if}
    </p>
  {/if}
</div>
<Dialog.Footer>
  <Button variant="outline" onclick={onback} disabled={busy || locked}>{t('import_back')}</Button>
  <Button onclick={onimport} disabled={busy || name.trim() === ''} data-testid="geojson-import">
    {busy ? t('import_publishing') : t('import_publish_import')}
  </Button>
</Dialog.Footer>
