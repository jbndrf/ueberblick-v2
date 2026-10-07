<script lang="ts">
  // The frame every row of the view builder shares (v3: the property row, `StageClause` / `DateClause` /
  // `CreatedByClause` all open with this: a bordered box, the row's name, the X that removes it).
  import type { Snippet } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import X from '@lucide/svelte/icons/x';
  import { message, type Locale } from '../../../messages';

  interface Props {
    locale: Locale;
    /** The row's name; a field row shows the field label large and the Objektart under it (`subtitle`). */
    title: string;
    subtitle?: string | undefined;
    /** v3's small uppercase heading of the "other" rows. */
    caps?: boolean;
    kind: string;
    onremove: () => void;
    children: Snippet;
  }
  let { locale, title, subtitle, caps = false, kind, onremove, children }: Props = $props();
</script>

<div class="space-y-2 rounded-md border p-3" data-clause={kind}>
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0 flex-1">
      <div
        class="truncate {caps
          ? 'text-xs font-semibold text-muted-foreground uppercase'
          : 'text-sm font-medium'}"
      >
        {title}
      </div>
      {#if subtitle !== undefined}
        <div class="truncate text-xs text-muted-foreground">{subtitle}</div>
      {/if}
    </div>
    <Button
      variant="ghost"
      size="icon"
      class="h-6 w-6 shrink-0"
      aria-label={message(locale, 'filter_builder_remove')}
      title={message(locale, 'filter_builder_remove')}
      onclick={onremove}
    >
      <X class="h-3.5 w-3.5" />
    </Button>
  </div>
  {@render children()}
</div>
