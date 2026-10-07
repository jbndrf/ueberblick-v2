<script lang="ts">
  // v3's "Kartenlayer" sheet (LayerSheet.svelte:1-120): the base maps as radios (one at a time), the overlays as
  // switches, a label each. No overlay behind the sheet, so the map stays visible and usable. Layers come from the
  // layer controller (the person's roles are already applied); this sheet decides nothing.
  import { onMount, untrack } from 'svelte';
  import * as Sheet from '@ueberblick/ui/components/ui/sheet';
  import * as RadioGroup from '@ueberblick/ui/components/ui/radio-group';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { Separator } from '@ueberblick/ui/components/ui/separator';
  import { localize } from '@ueberblick/ui';
  import { orderedLayerKeys } from '@ueberblick/core/registry';
  import { message, type Locale } from '../../messages';
  import type { LayerController } from './layer-controller';

  interface Props {
    open?: boolean;
    controller: LayerController;
    locale: Locale;
  }
  let { open = $bindable(false), controller, locale }: Props = $props();

  let selection = $state(untrack(() => controller.selection()));
  onMount(() => controller.subscribe(() => (selection = controller.selection())));

  const rows = $derived.by(() => {
    const map = controller.map();
    const keys = map === undefined ? [] : orderedLayerKeys(map);
    const of = (kind: string) =>
      keys
        .filter((k) => map?.layers[k]?.kind === kind)
        .map((key) => ({ key, label: localize(map?.layers[key]?.label ?? key, locale) }));
    return { base: of('base'), overlay: of('overlay') };
  });
</script>

<Sheet.Root bind:open>
  <Sheet.ContentNoOverlay side="left" class="w-80" preventScroll={false}>
    <Sheet.Header>
      <Sheet.Title>{message(locale, 'layer_title')}</Sheet.Title>
      <Sheet.Description>{message(locale, 'layer_description')}</Sheet.Description>
    </Sheet.Header>

    <div class="space-y-6 overflow-y-auto px-4 py-6">
      {#if rows.base.length > 0}
        <div>
          <h3 class="mb-3 text-sm font-medium">{message(locale, 'layer_base')}</h3>
          <RadioGroup.Root value={selection.base ?? ''} onValueChange={(key) => controller.setBase(key)}>
            <div class="space-y-2">
              {#each rows.base as layer (layer.key)}
                <div class="flex items-center space-x-3 rounded-lg border p-3">
                  <RadioGroup.Item value={layer.key} id="base-{layer.key}" />
                  <Label for="base-{layer.key}" class="flex-1 cursor-pointer text-sm font-medium">
                    {layer.label}
                  </Label>
                </div>
              {/each}
            </div>
          </RadioGroup.Root>
        </div>
      {/if}

      {#if rows.base.length > 0 && rows.overlay.length > 0}
        <Separator />
      {/if}

      {#if rows.overlay.length > 0}
        <div>
          <h3 class="mb-3 text-sm font-medium">{message(locale, 'layer_overlays')}</h3>
          <div class="space-y-2">
            {#each rows.overlay as layer (layer.key)}
              <div class="flex items-center justify-between space-x-3 rounded-lg border p-3">
                <Label for="overlay-{layer.key}" class="flex-1 cursor-pointer text-sm font-medium">
                  {layer.label}
                </Label>
                <Switch
                  id="overlay-{layer.key}"
                  checked={selection.overlays.includes(layer.key)}
                  onCheckedChange={(on) => controller.toggleOverlay(layer.key, on)}
                />
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#if rows.base.length === 0 && rows.overlay.length === 0}
        <div class="py-8 text-center text-sm text-muted-foreground">{message(locale, 'layer_none')}</div>
      {/if}
    </div>
  </Sheet.ContentNoOverlay>
</Sheet.Root>
