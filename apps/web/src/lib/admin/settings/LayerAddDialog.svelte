<script lang="ts">
  // v3 "Add Layer Dialog" (`LayersSection.svelte:392-675`): max-w-2xl, 90vh high with a scrolling body, tabs Voreinstellungen
  // (a list of presets, "Hinzugefügt" badge once on, plus icon) / Kachel-URL / WMS / Hochladen; each form has Name, its
  // source fields, Quellenangabe (optional), the "als Basis" switch and one submit button ("Wird hinzugefügt..." while it
  // works). v4: the Hochladen tab (ZIP, MBTiles and PMTiles file upload, `LayerUploadTab.svelte`, WP-406) keeps v3's place
  // after WMS; the PMTiles tab adds an archive by its URL and GeoJSON is a further source type.
  import Plus from '@lucide/svelte/icons/plus';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import * as Tabs from '@ueberblick/ui/components/ui/tabs';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import LayerUploadTab from './LayerUploadTab.svelte';
  import LayerSourceFields from './LayerSourceFields.svelte';
  import { ADD_TABS, draftOf, emptyForm, PRESET_ROWS, type LayerFormValues } from './layers-forms';
  import { validateLayerDraft, type LayerDraft, type LayerRowData } from './layers-model';

  let {
    open = $bindable(false),
    locale,
    layers,
    project,
    onadd,
  }: {
    open?: boolean;
    locale: Locale;
    layers: readonly LayerRowData[];
    /** The project key: the upload endpoints are the project's. */
    project: string;
    /** Adds the layer; true when it worked (the dialog then closes and forgets what was typed). */
    onadd: (layer: LayerDraft) => Promise<boolean>;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);
  const uid = $props.id();
  let tab = $state('preset');
  let busy = $state(false);
  let problem = $state<AdminKey | null>(null);
  type TabType = (typeof ADD_TABS)[number]['type'];
  let forms = $state<Record<TabType, LayerFormValues>>({
    xyz: emptyForm(),
    wms: emptyForm(),
    pmtiles: emptyForm(),
    geojson: emptyForm(),
  });

  const hasBase = $derived(layers.some((l) => l.kind === 'base'));
  const presetName = (key: string): string => t(`settings_layers_preset_${key}` as AdminKey);

  $effect(() => {
    if (open) problem = null; // a fresh look each time the dialog opens
  });

  async function submit(type: TabType, event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const draft = draftOf(type, forms[type]);
    const bad = validateLayerDraft(draft);
    problem = bad === null ? null : (`settings_layers_err_${bad}` as AdminKey);
    if (bad !== null) return;
    busy = true;
    const done = await onadd(draft);
    busy = false;
    if (done) forms[type] = emptyForm();
  }

  async function addPreset(row: (typeof PRESET_ROWS)[number]): Promise<void> {
    busy = true;
    await onadd(row.draft(presetName(row.key), hasBase));
    busy = false;
  }

  /** A vector archive that was uploaded: the PMTiles tab asks for its source layer (an overlay of tile type vector). */
  function toPmtiles(name: string, url: string): void {
    forms.pmtiles = { ...emptyForm(), name, url, tileType: 'vector' };
    tab = 'pmtiles';
  }

  const ready = (type: TabType): boolean => {
    const f = forms[type];
    const hasWmsLayers = type !== 'wms' || f.wmsLayers.trim() !== '';
    return f.name.trim() !== '' && f.url.trim() !== '' && hasWmsLayers;
  };
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[90vh] max-w-2xl flex-col" data-testid="layer-add-dialog">
    <Dialog.Header class="shrink-0">
      <Dialog.Title>{t('settings_layers_add_title')}</Dialog.Title>
      <Dialog.Description>{t('settings_layers_add_description')}</Dialog.Description>
    </Dialog.Header>

    <Tabs.Root bind:value={tab} class="flex flex-1 flex-col overflow-hidden">
      <div class="shrink-0 overflow-x-auto">
        <Tabs.List>
          <Tabs.Trigger value="preset">{t('settings_layers_tab_presets')}</Tabs.Trigger>
          {#each ADD_TABS as x (x.type)}
            <Tabs.Trigger value={x.type}>{t(x.label)}</Tabs.Trigger>
            {#if x.type === 'wms'}
              <Tabs.Trigger value="upload">{t('settings_layers_tab_upload')}</Tabs.Trigger>
            {/if}
          {/each}
        </Tabs.List>
      </div>

      <div class="flex-1 overflow-y-auto pt-4 pr-2">
        <Tabs.Content value="preset">
          <div class="grid gap-2">
            {#each PRESET_ROWS as preset (preset.key)}
              <button
                type="button"
                class="flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                disabled={busy || preset.isAdded(layers)}
                onclick={() => void addPreset(preset)}
              >
                <div>
                  <div class="text-sm font-medium">{presetName(preset.key)}</div>
                  <div class="text-xs text-muted-foreground">
                    {preset.kind === 'wms' ? t('settings_layers_tab_wms') : t('settings_layers_tiles')} -- {t(
                      'settings_layers_zoom',
                    )} 0-{preset.maxzoom}
                  </div>
                </div>
                {#if preset.isAdded(layers)}
                  <Badge variant="outline" class="text-xs">{t('settings_layers_added')}</Badge>
                {:else}
                  <Plus class="h-4 w-4 text-muted-foreground" />
                {/if}
              </button>
            {/each}
          </div>
        </Tabs.Content>

        <Tabs.Content value="upload">
          <LayerUploadTab {locale} {project} id="{uid}-upload" {onadd} onvector={toPmtiles} />
        </Tabs.Content>

        {#each ADD_TABS as x (x.type)}
          <Tabs.Content value={x.type}>
            <form class="space-y-4" onsubmit={(e) => void submit(x.type, e)} novalidate>
              <div class="space-y-2">
                <Label for="{uid}-{x.type}-name">{t('settings_layers_field_name')}</Label>
                <Input
                  id="{uid}-{x.type}-name"
                  bind:value={forms[x.type].name}
                  placeholder={t('settings_layers_name_placeholder')}
                  required
                />
              </div>
              <LayerSourceFields type={x.type} bind:form={forms[x.type]} {locale} id="{uid}-{x.type}" />
              <div class="space-y-2">
                <Label for="{uid}-{x.type}-attribution">{t('settings_layers_attribution_optional')}</Label>
                <Input id="{uid}-{x.type}-attribution" bind:value={forms[x.type].attribution} />
              </div>
              <div class="flex items-center space-x-2">
                <Switch id="{uid}-{x.type}-base" bind:checked={forms[x.type].asBase} />
                <Label for="{uid}-{x.type}-base">{t('settings_layers_set_as_base_layer')}</Label>
              </div>
              {#if problem}<p class="text-sm text-destructive" role="alert">{t(problem)}</p>{/if}
              <Button type="submit" disabled={busy || !ready(x.type)}>
                {busy ? t('settings_layers_adding') : t('settings_layers_add_submit')}
              </Button>
            </form>
          </Tabs.Content>
        {/each}
      </div>
    </Tabs.Root>
  </Dialog.Content>
</Dialog.Root>
