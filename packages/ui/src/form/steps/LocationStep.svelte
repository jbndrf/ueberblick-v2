<script lang="ts">
  // v3's location edit (reference LocationEditTool.svelte; detail module :583-606): the participant moves the pin or
  // redraws the shape on the map and confirms. Here it is one step of the flow: the map picker is a port, this page
  // shows what is chosen and the footer goes on (Weiter / Absenden) once a location is chosen.
  import MapPin from '@lucide/svelte/icons/map-pin';
  import { Button } from '../../components/ui/button';
  import { TARGET_SIZE } from '../../tokens';
  import type { StepLabels } from './contract';

  interface Props {
    label: string;
    chosen: boolean;
    picking: boolean;
    canPick: boolean;
    last: boolean;
    labels: StepLabels;
    onpick: () => void;
    onback: () => void;
    onnext: () => void;
  }
  let { label, chosen, picking, canPick, last, labels, onpick, onback, onnext }: Props = $props();
</script>

<div class="flex min-h-full flex-col">
  <div class="flex-1 space-y-4 p-4">
    <h3 class="text-sm font-semibold text-foreground">{label}</h3>
    <p class="text-sm text-muted-foreground" role="status">
      {chosen ? labels.locationSet : labels.locationUnset}
    </p>
    <Button
      type="button"
      variant={chosen ? 'outline' : 'default'}
      class="w-full"
      style={`min-height:${TARGET_SIZE.primary}px`}
      disabled={!canPick || picking}
      onclick={onpick}
    >
      <MapPin class="mr-2 h-4 w-4" aria-hidden="true" />
      {labels.locationPick}
    </Button>
    {#if !canPick}<p class="text-sm text-destructive" role="alert">{labels.locationUnavailable}</p>{/if}
  </div>
  <div class="sticky bottom-0 flex gap-2 border-t border-border bg-background p-4">
    <Button
      type="button"
      variant="outline"
      class="flex-1"
      style={`min-height:${TARGET_SIZE.primary}px`}
      onclick={onback}
    >
      {labels.back}
    </Button>
    <Button
      type="button"
      class="flex-1"
      style={`min-height:${TARGET_SIZE.primary}px`}
      disabled={!chosen}
      onclick={onnext}
    >
      {last ? labels.submit : labels.next}
    </Button>
  </div>
</div>
