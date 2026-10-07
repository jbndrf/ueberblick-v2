<script lang="ts">
  // Step 1 'Hochladen' (v3 `csv-import-dialog.svelte:318-331`, `geojson-import-dialog.svelte:179-197`): the file input
  // and 'Abbrechen'. The CSV and the GeoJSON wizard share it; each names its label, file kinds and error.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import type { AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { T } from './i18n';

  let {
    t,
    error = null,
    labelKey,
    accept,
    inputId,
    testid,
    onfile,
    oncancel,
  }: {
    t: T;
    /** The message of the read error, or null. */
    error?: AdminKey | null;
    labelKey: AdminKey;
    accept: string;
    inputId: string;
    testid: string;
    onfile: (file: File) => void;
    oncancel: () => void;
  } = $props();
</script>

<div class="space-y-4 py-4">
  <div class="space-y-2">
    <Label for={inputId}>{t(labelKey)}</Label>
    <Input
      id={inputId}
      type="file"
      {accept}
      data-testid={testid}
      onchange={(e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) onfile(file);
      }}
    />
  </div>
  {#if error}
    <p role="alert" class="text-sm text-destructive">{t(error)}</p>
  {/if}
</div>
<Dialog.Footer>
  <Button variant="outline" onclick={oncancel}>{t('import_cancel')}</Button>
</Dialog.Footer>
