<script lang="ts">
  // The values one run changed (v3 `docEntryDetail`, Module:1325-1372): "Label: value", photos as thumbnails, ids as
  // badges (an id that cannot be resolved on this device as a short token, never a bare id), and "Standort: Standort
  // aktualisiert" for a geometry write.
  import { shortId } from '@ueberblick/core';
  import { MediaGallery, type ActivityRun } from '@ueberblick/ui';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { message, type Locale } from '../../messages';

  interface Props {
    run: ActivityRun;
    locale: Locale;
  }
  let { run, locale }: Props = $props();
</script>

<div class="pt-0.5 pb-2" data-testid="activity-detail">
  {#if run.touchedGeometry}
    <div class="mb-0.5 flex gap-1.5 text-xs">
      <span class="shrink-0 text-muted-foreground">{message(locale, 'activity_location')}:</span>
      <span class="font-medium">{message(locale, 'activity_location_updated')}</span>
    </div>
  {/if}
  {#each run.fields as field (field.key)}
    {#if field.files.length > 0}
      <div class="mb-0.5 flex items-center gap-1.5 text-xs">
        <span class="shrink-0 text-muted-foreground">{field.label}:</span>
        <MediaGallery files={field.files} mode="view" size="list" />
      </div>
    {:else}
      <div class="mb-0.5 flex gap-1.5 text-xs">
        <span class="shrink-0 text-muted-foreground">{field.label}:</span>
        {#if field.links.length > 0}
          <span class="flex flex-wrap gap-1">
            {#each field.links as link (link.id)}
              {#if link.label === link.id}
                <Badge
                  variant="outline"
                  class="font-mono font-normal text-muted-foreground"
                  title={message(locale, 'activity_unresolved', { id: link.id })}>{shortId(link.id)}</Badge
                >
              {:else}
                <Badge variant="secondary">{link.label}</Badge>
              {/if}
            {/each}
          </span>
        {:else}
          <span class="truncate font-medium">
            {field.empty ? message(locale, 'activity_empty_value') : field.text}
          </span>
        {/if}
      </div>
    {/if}
  {/each}
</div>
