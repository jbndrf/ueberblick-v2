<script lang="ts">
  import { m } from '../../../paraglide/messages.js';
  import { cn } from '../../../utils.js';
  import Loader2Icon from '@lucide/svelte/icons/loader-2';
  import type { ComponentProps } from 'svelte';

  type Props = ComponentProps<typeof Loader2Icon>;

  let { class: className, ...restProps }: Props = $props();
</script>

<Loader2Icon
  role="status"
  aria-label={m.ui_loading()}
  class={cn('size-4 animate-spin motion-reduce:animate-none', className)}
  {...restProps}
/>
