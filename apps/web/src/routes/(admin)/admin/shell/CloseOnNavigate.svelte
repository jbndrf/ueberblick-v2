<script lang="ts">
  // Phone: the sidebar is a sheet, and v3 closed it on navigation (`admin/+layout.svelte`). A new pathname
  // closes it, so every link and a created Objektart's builder leave the page visible (WP-515).
  import * as Sidebar from '@ueberblick/ui/components/ui/sidebar';

  let { pathname }: { pathname: string } = $props();
  const sidebar = Sidebar.useSidebar();
  let seen = pathname;
  $effect(() => {
    if (pathname === seen) return;
    seen = pathname;
    sidebar.setOpenMobile(false);
  });
</script>
