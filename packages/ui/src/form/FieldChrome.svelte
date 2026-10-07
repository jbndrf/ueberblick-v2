<script lang="ts">
  // The frame of one field in v3's form (reference FieldRenderer.svelte:522-535, 801-808): the label with the red
  // required star, the control, the help text and the error under it.
  import type { Snippet } from 'svelte';
  import { Label } from '../components/ui/label';
  import { m } from '../paraglide/messages.js';
  import { hintId, errorId } from './chrome';
  import Link2Icon from '@lucide/svelte/icons/link-2';
  import { Badge } from '../components/ui/badge';

  interface Props {
    id: string;
    label: string;
    required: boolean;
    hint?: string | undefined;
    error?: string | undefined;
    /** Id of the control the label names. Without it the label is plain text that names the group. */
    labelFor?: string | undefined;
    /** The origin label of a field that edits a bound Objekt (A-047). */
    origin?: string | undefined;
    children: Snippet;
  }
  let { id, label, required, hint, error, labelFor, origin, children }: Props = $props();
</script>

<div class="space-y-1.5" data-testid="field" data-field-id={id}>
  {#if labelFor}
    <Label for={labelFor} class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {label}
      {#if required}<span class="text-destructive" aria-hidden="true">*</span><span class="sr-only"
          >({m.ui_required()})</span
        >{/if}
    </Label>
  {:else}
    <span
      id={`${id}-label`}
      class="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"
    >
      {label}
      {#if required}<span class="text-destructive" aria-hidden="true">*</span><span class="sr-only"
          >({m.ui_required()})</span
        >{/if}
    </span>
  {/if}
  {@render children()}
  {#if origin}
    <Badge variant="secondary" class="mt-1.5 gap-1 text-[10px]" data-testid="field-origin"
      ><Link2Icon aria-hidden="true" />{origin}</Badge
    >
  {/if}
  {#if hint}<p class="text-xs text-muted-foreground" id={hintId(id)}>{hint}</p>{/if}
  {#if error}<p class="text-xs text-destructive" id={errorId(id)}>{error}</p>{/if}
</div>
