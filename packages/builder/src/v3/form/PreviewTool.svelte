<script lang="ts">
  // The tool slot of a card's preview (v3 `FieldCard` drew a dashed "Datei wählen ..." box for a file field).
  // The editor shows where the participant's tool goes; the tool itself belongs to the participant's form.
  import MapPin from '@lucide/svelte/icons/map-pin';
  import Upload from '@lucide/svelte/icons/upload';
  import type { Translate } from '../../shell/messages';

  interface Props {
    t: Translate;
    type: string;
  }
  let { t, type }: Props = $props();
</script>

<div class="slot">
  {#if type === 'geometry'}
    <MapPin size={16} /><span>{t('form_card_geometry')}</span>
  {:else}
    <Upload size={16} /><span>{t('form_card_file')}</span>
  {/if}
</div>

<style>
  .slot {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    color: var(--muted-foreground);
    background: color-mix(in oklab, var(--muted) 50%, transparent);
    border: 1px dashed var(--border);
    border-radius: 0.375rem;
  }
</style>
