<script lang="ts">
  // One lucide icon per sidebar entry (v3's icons, `+layout.svelte:37-55`).
  import FolderKanban from '@lucide/svelte/icons/folder-kanban';
  import History from '@lucide/svelte/icons/history';
  import MapPin from '@lucide/svelte/icons/map-pin';
  import Network from '@lucide/svelte/icons/network';
  import Settings from '@lucide/svelte/icons/settings';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Table from '@lucide/svelte/icons/table';
  import Users from '@lucide/svelte/icons/users';
  import Workflow from '@lucide/svelte/icons/workflow';
  import type { NavIcon } from './nav';

  let { name }: { name: NavIcon } = $props();
  const ICONS = {
    projects: FolderKanban,
    settings: Settings,
    participants: Users,
    roles: ShieldCheck,
    relations: Network,
    versions: History,
    objektart: MapPin,
    process: Workflow,
    tables: Table,
  } as const;
  const Icon = $derived(ICONS[name]);
</script>

<Icon class="h-4 w-4" />
