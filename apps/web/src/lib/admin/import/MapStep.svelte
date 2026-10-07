<script lang="ts">
  // Step 2 'Zuordnen' (v3 `csv-import-dialog.svelte:333-445`): rows and columns found, 'In Stufe importieren', the table
  // 'CSV-Spalte | Zuordnung | Vorschau' with 'Überspringen' and starred required targets, 'Zurück' and 'Weiter'. v3's
  // 'Status' column (lat/lng and empty-value checks per column) is the dry run's job here (R1): its answer is step 3.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { GEO_SOURCE_CRS } from '@ueberblick/core';
  import ConstantsEditor from './ConstantsEditor.svelte';
  import type { CsvScan } from './csv-scan';
  import type { T } from './i18n';
  import { SELECT_CLASS } from './i18n';
  import { LAT, LON, missingRequired, type MappingState, type Target } from './mapping';
  import type { ImportSetup } from './setup';

  let {
    t,
    scan,
    setup,
    targets,
    mapping = $bindable(),
    checking = false,
    onback,
    onnext,
  }: {
    t: T;
    scan: CsvScan;
    setup: ImportSetup;
    targets: readonly Target[];
    mapping: MappingState;
    /** The dry run is under way. */
    checking?: boolean;
    onback: () => void;
    onnext: () => void;
  } = $props();

  const mapped = $derived(new Set(Object.values(mapping.columns).filter(Boolean)));
  const missing = $derived(missingRequired(targets, mapping.columns));
  const hasCoordinates = $derived(mapped.has(LON) || mapped.has(LAT));
  const constantsAvailable = $derived(setup.constants.filter((c) => !mapped.has(c.key)));
  const availableFor = (header: string): Target[] =>
    targets.filter((x) => !mapped.has(x.id) || x.id === mapping.columns[header]);

  function choose(header: string, id: string): void {
    mapping = {
      ...mapping,
      columns: { ...mapping.columns, [header]: id },
      constants: mapping.constants.filter((c) => c.key !== id),
    };
  }
</script>

<div class="space-y-4 py-4">
  <p class="text-sm text-muted-foreground" data-testid="import-found">
    {t('import_found', { rows: scan.rowCount, columns: scan.headers.length })}
  </p>

  {#if setup.stage}
    <div class="space-y-2">
      <Label for="import-stage">{t('import_target_stage')}</Label>
      <select
        id="import-stage"
        class={SELECT_CLASS}
        value={mapping.stage}
        onchange={(e) => (mapping = { ...mapping, stage: (e.target as HTMLSelectElement).value })}
      >
        {#each setup.stage.options as o (o.value)}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
      <p class="text-xs text-muted-foreground">{t('import_target_stage_hint')}</p>
    </div>
  {/if}

  <div class="overflow-x-auto rounded-md border">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b bg-muted/50">
          <th class="p-2 text-left font-medium whitespace-nowrap">{t('import_col_csv')}</th>
          <th class="p-2 text-left font-medium whitespace-nowrap">{t('import_col_maps_to')}</th>
          <th class="p-2 text-left font-medium whitespace-nowrap">{t('import_col_preview')}</th>
        </tr>
      </thead>
      <tbody>
        {#each scan.headers as header, i (i)}
          <tr class="border-b last:border-0">
            <td class="p-2 font-mono text-xs whitespace-nowrap">{header}</td>
            <td class="p-2">
              <select
                class="{SELECT_CLASS} min-w-[140px] py-1.5"
                aria-label="{t('import_col_maps_to')}: {header}"
                data-testid="map-{i}"
                value={mapping.columns[header] ?? ''}
                onchange={(e) => choose(header, (e.target as HTMLSelectElement).value)}
              >
                <option value="">-- {t('import_skip')} --</option>
                {#each availableFor(header) as target (target.id)}
                  <option value={target.id}>{target.label}{target.required ? ' *' : ''}</option>
                {/each}
              </select>
            </td>
            <td class="max-w-[150px] truncate p-2 text-xs text-muted-foreground">
              {scan.firstRows[0]?.[i] ?? ''}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if hasCoordinates}
    <div class="space-y-2">
      <Label for="import-crs">{t('import_crs')}</Label>
      <select
        id="import-crs"
        class={SELECT_CLASS}
        value={mapping.crs}
        onchange={(e) => (mapping = { ...mapping, crs: (e.target as HTMLSelectElement).value })}
      >
        {#each GEO_SOURCE_CRS.entries as c (c.key)}
          <option value={c.key}>{c.key}</option>
        {/each}
      </select>
      <p class="text-xs text-muted-foreground">{t('import_crs_hint')}</p>
    </div>
  {/if}

  <ConstantsEditor {t} available={constantsAvailable} bind:rows={mapping.constants} />

  {#if missing.length > 0}
    <p class="text-sm text-destructive" role="alert">{t('import_required_missing')}</p>
  {/if}
</div>
<Dialog.Footer>
  <Button variant="outline" onclick={onback} disabled={checking}>{t('import_back')}</Button>
  <Button onclick={onnext} disabled={missing.length > 0 || checking} data-testid="import-next">
    {checking ? t('import_checking') : t('import_continue')}
  </Button>
</Dialog.Footer>
