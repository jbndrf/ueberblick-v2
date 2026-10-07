<script lang="ts">
  // The shell with a fixed page body, for the shell spec (WP-320).
  import { Toaster } from '@ueberblick/ui/components/ui/sonner';
  import AdminShell from './AdminShell.svelte';
  import type { ComponentProps } from 'svelte';

  let props: Omit<ComponentProps<typeof AdminShell>, 'children'> = $props();
</script>

<Toaster />
<AdminShell {...props}>
  {#snippet children()}<p>Inhalt</p>{/snippet}
</AdminShell>
