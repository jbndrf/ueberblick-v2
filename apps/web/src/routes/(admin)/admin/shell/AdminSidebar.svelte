<script lang="ts">
  // The sidebar's content (v3 `+layout.svelte:318-575`), built from the item list in `nav.ts`. The groups
  // Objektarten and Tabellen list the types of the project's draft (WP-343, v3 `:395-545`).
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import FileUp from '@lucide/svelte/icons/file-up';
  import MapPin from '@lucide/svelte/icons/map-pin';
  import Plus from '@lucide/svelte/icons/plus';
  import Table from '@lucide/svelte/icons/table';
  import * as Sidebar from '@ueberblick/ui/components/ui/sidebar';
  import * as DropdownMenu from '@ueberblick/ui/components/ui/dropdown-menu';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { SortableItem, SortableState, type Reorder } from '@ueberblick/ui/components/ui/sortable';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import DraftBadge from '../../../../lib/admin/draft/DraftBadge.svelte';
  import { notifyDraftChanged } from '../../../../lib/admin/draft/status-store.svelte';
  import GeojsonImportDialog from '../../../../lib/admin/import/GeojsonImportDialog.svelte';
  import { GLOBAL_ITEMS } from '../../../../lib/admin/instance/nav';
  import NavIcon from './NavIcon.svelte';
  import { adminMessage, type AdminKey } from './messages';
  import {
    GROUPS,
    PROJECTS_ITEM,
    isActive,
    isTypeActive,
    projectItems,
    typeHref,
    type NavGroup,
    type NavItem,
    type ShellProject,
  } from './nav';
  import { entryHref, reorderGroup, tablesHref, type SidebarType } from './sidebar-types';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { createTypeEditor } from './sidebar-types-client';
  import type { Locale } from './locale';

  let {
    locale,
    pathname,
    projects,
    currentProject,
    types = [],
    navigate = () => undefined,
    refresh = async () => undefined,
    draftFetch,
  }: {
    locale: Locale;
    pathname: string;
    projects: readonly ShellProject[];
    currentProject: ShellProject | null;
    /** The open project's types, from its draft. */
    types?: readonly SidebarType[];
    navigate?: (href: string) => void;
    /** Reads the types again after the draft changed. */
    refresh?: () => Promise<void>;
    draftFetch?: typeof fetch | undefined;
  } = $props();

  const t = (key: AdminKey): string => adminMessage(locale, key);
  // Group folding is per visit, as in v3 (`workflowsCollapsed`, `tablesCollapsed`).
  let collapsed = $state<Record<string, boolean>>({});

  // The order the list shows while a drag is being saved (v3 `workflowOrderOverride`, `+layout.svelte:76-77`).
  let orderOverride = $state<readonly string[] | null>(null);
  const shown = $derived(
    orderOverride === null
      ? types
      : [...types].sort(
          (a, b) => (orderOverride?.indexOf(a.key) ?? 0) - (orderOverride?.indexOf(b.key) ?? 0),
        ),
  );
  const inGroup = (group: NavGroup): SidebarType[] => shown.filter((tp) => tp.kind === group.kind);

  // Drag and drop with a drop line (v3 `onWorkflowDragStart` … `onWorkflowDrop`, `:79-136`), now the kit's sortable
  // (WP-408): drag, and Alt+ArrowUp/ArrowDown on a focused entry. Objektarten only, as in v3: tables had no drag.
  // HTML5 drag needs a pointer, so the sheet on a phone lists but does not sort.
  const sortable = new SortableState();

  async function reorder(change: Reorder): Promise<void> {
    if (!currentProject) return;
    const all = reorderGroup(
      shown.map((tp) => tp.key),
      change.keys,
    );
    orderOverride = all; // optimistic, as in v3
    const ok = await createTypeEditor({ project: currentProject.key, fetch: draftFetch ?? fetch }).reorder(
      all,
    );
    if (ok) notifyDraftChanged();
    else toast.error(t('nav_reorder_error')); // v3 `:122-127`
    await refresh();
    orderOverride = null;
  }

  // The "+" menus. v3 created at once and opened the new workflow (`createWorkflow`, `createTable`, `:157-259`);
  // here the admin names it first, because the draft needs a name and a key (WP-343 acceptance).
  // v3's third item of the Workflows "+" menu, 'GeoJSON importieren' (`+layout.svelte:428-431`), opens the wizard.
  let geojsonOpen = $state(false);
  let creating = $state<NavGroup | null>(null);
  let newName = $state('');
  let busy = $state(false);
  function openCreate(group: NavGroup): void {
    creating = group;
    newName = '';
  }
  async function create(e: Event): Promise<void> {
    e.preventDefault();
    const group = creating;
    const name = newName.trim();
    if (!group || !currentProject || name === '' || busy) return;
    busy = true;
    const r = await createTypeEditor({ project: currentProject.key, fetch: draftFetch ?? fetch }).addType(
      group.kind,
      name,
      types.map((tp) => tp.key),
    );
    busy = false;
    if (!r.ok) {
      toast.error(t(group.createError)); // v3 `:174-178`
      return;
    }
    creating = null;
    notifyDraftChanged();
    await refresh();
    // v3 opened the new workflow in its builder and the new table on its page (`createWorkflow`, `createTable`, `:157-259`).
    navigate(
      group.kind === 'table'
        ? entryHref(currentProject.key, { key: r.key, kind: 'table' })
        : typeHref(currentProject.key, r.key),
    );
  }
</script>

{#snippet item(it: NavItem)}
  <Sidebar.MenuItem>
    <Sidebar.MenuButton isActive={isActive(pathname, it.href)}>
      {#snippet child({ props })}
        <a href={it.href} {...props}>
          <NavIcon name={it.icon} />
          <span>{t(it.label)}</span>
        </a>
      {/snippet}
    </Sidebar.MenuButton>
  </Sidebar.MenuItem>
{/snippet}

{#snippet typeEntry(group: NavGroup, tp: SidebarType, project: string)}
  {@const canSort = group.kind === 'objektart'}
  <Sidebar.MenuItem>
    <SortableItem
      state={sortable}
      id={tp.key}
      keys={inGroup(group).map((x) => x.key)}
      disabled={!canSort}
      role="presentation"
      onreorder={reorder}
      data-testid="type-entry-{tp.key}"
    >
      <Sidebar.MenuSubButton href={entryHref(project, tp)} isActive={isTypeActive(pathname, project, tp.key)}>
        {#if group.kind === 'table'}
          <Table class="h-4 w-4" />
        {:else if tp.geometry}
          <MapPin class="h-4 w-4" />
        {:else}
          <NavIcon name="process" />
        {/if}
        <span>{tp.label}</span>
      </Sidebar.MenuSubButton>
    </SortableItem>
  </Sidebar.MenuItem>
{/snippet}

<Sidebar.Content>
  <Sidebar.Header>
    <div class="flex items-center gap-2 px-2 py-2">
      <img src="/icons/logo-light.png" alt="" class="h-8 w-8 object-contain dark:invert" />
      <span class="text-lg font-semibold">{t('product')}</span>
    </div>
  </Sidebar.Header>

  <div class="flex-1 overflow-y-auto px-2">
    <Sidebar.Menu>{@render item(PROJECTS_ITEM)}</Sidebar.Menu>

    {#if currentProject}
      <Sidebar.Separator class="my-3" />
      <div class="mb-2 px-2 py-1">
        <span class="text-xs font-semibold tracking-wider text-muted-foreground uppercase"
          >{currentProject.name}</span
        >
      </div>
      <DraftBadge {locale} project={currentProject.key} />
      <Sidebar.Menu>
        {#each projectItems(currentProject.key) as it (it.key)}
          {@render item(it)}
        {/each}
      </Sidebar.Menu>

      <Sidebar.Separator class="my-3" />
      {#each GROUPS as group (group.key)}
        {@const entries = inGroup(group)}
        <Sidebar.Group data-testid="group-{group.key}">
          <Sidebar.GroupLabel class="flex items-center justify-between">
            <span class="flex items-center gap-1">
              <button
                type="button"
                class="flex items-center gap-1 transition-colors hover:text-foreground"
                aria-expanded={!collapsed[group.key]}
                aria-label={group.kind === 'table' ? t(group.label) : undefined}
                onclick={() => (collapsed[group.key] = !collapsed[group.key])}
              >
                <ChevronRight
                  class="h-3 w-3 transition-transform {collapsed[group.key] ? '' : 'rotate-90'}"
                />
                {#if group.kind !== 'table'}{t(group.label)}{/if}
              </button>
              {#if group.kind === 'table'}
                <!-- v3's Tabellen list page was linked from nowhere; its group header opens it now (register a1). -->
                <a
                  href={tablesHref(currentProject.key)}
                  class="transition-colors hover:text-foreground"
                  data-testid="tables-overview-link">{t(group.label)}</a
                >
              {/if}
            </span>
          </Sidebar.GroupLabel>
          <DropdownMenu.Root>
            <!-- The button itself is the group action (kit `child`): v3 nested a button in it, and on a phone the
                 action's enlarged touch area then swallowed the tap. -->
            <Sidebar.GroupAction>
              {#snippet child({ props: action })}
                <DropdownMenu.Trigger>
                  {#snippet child({ props })}
                    <button type="button" {...action} {...props}>
                      <Plus class="h-4 w-4" />
                      <span class="sr-only">{t(group.add)}</span>
                    </button>
                  {/snippet}
                </DropdownMenu.Trigger>
              {/snippet}
            </Sidebar.GroupAction>
            <DropdownMenu.Content side="right" align="start" class="w-48">
              <DropdownMenu.Item onclick={() => openCreate(group)}>
                {#if group.kind === 'table'}
                  <Table class="mr-2 h-4 w-4" />
                {:else}
                  <MapPin class="mr-2 h-4 w-4" />
                {/if}
                {t(group.create)}
              </DropdownMenu.Item>
              {#if group.kind === 'objektart'}
                <DropdownMenu.Item onclick={() => (geojsonOpen = true)} data-testid="geojson-import-item">
                  <FileUp class="mr-2 h-4 w-4" />
                  {t('nav_import_geojson')}
                </DropdownMenu.Item>
              {/if}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          {#if !collapsed[group.key]}
            <Sidebar.GroupContent>
              <Sidebar.Menu>
                {#each entries as tp (tp.key)}
                  {@render typeEntry(group, tp, currentProject.key)}
                {/each}
                {#if entries.length === 0}
                  <div class="px-3 py-2 text-xs text-muted-foreground">{t(group.empty)}</div>
                {/if}
              </Sidebar.Menu>
            </Sidebar.GroupContent>
          {/if}
        </Sidebar.Group>
      {/each}
    {:else if projects.length > 0}
      <Sidebar.Separator class="my-4" />
      <Sidebar.Group>
        <Sidebar.GroupLabel>{t('nav_your_projects')}</Sidebar.GroupLabel>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            {#each projects as project (project.key)}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton>
                  {#snippet child({ props })}
                    <a href="/admin/projects/{project.key}/settings" {...props}>
                      <NavIcon name="projects" />
                      <span>{project.name}</span>
                    </a>
                  {/snippet}
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
    {:else}
      <Sidebar.Separator class="my-4" />
      <div class="px-4 py-3 text-center text-sm text-muted-foreground">
        <p>{t('nav_no_projects')}</p>
        <Button href="/admin/projects" variant="link" size="sm" class="mt-1"
          >{t('nav_create_first_project')}</Button
        >
      </div>
    {/if}

    <!-- v3's global menu: below a separator at the end of the list (`+layout.svelte:568-586`). -->
    <Sidebar.Separator class="my-4" />
    <Sidebar.Menu data-testid="global-menu">
      {#each GLOBAL_ITEMS as it (it.key)}
        {@render item(it)}
      {/each}
    </Sidebar.Menu>
  </div>
</Sidebar.Content>

<Dialog.Root open={creating !== null} onOpenChange={(open) => !open && (creating = null)}>
  <Dialog.Content data-testid="new-type-dialog">
    <form onsubmit={create} class="grid gap-4">
      <Dialog.Header>
        <Dialog.Title>{creating ? t(creating.create) : ''}</Dialog.Title>
        <Dialog.Description>{t('nav_new_description')}</Dialog.Description>
      </Dialog.Header>
      <label class="grid gap-1.5 text-sm font-medium">
        {t('nav_new_name')}
        <Input bind:value={newName} data-testid="new-type-name" autocomplete="off" />
      </label>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (creating = null)}
          >{t('nav_new_cancel')}</Button
        >
        <Button type="submit" disabled={busy || newName.trim() === ''} data-testid="new-type-create"
          >{t('nav_new_create')}</Button
        >
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

{#if currentProject}
  <GeojsonImportDialog
    bind:open={geojsonOpen}
    {locale}
    project={currentProject.key}
    fetchFn={draftFetch ?? fetch}
    onpublished={async () => {
      notifyDraftChanged();
      await refresh();
    }}
    ondone={(key) => {
      if (currentProject) navigate(`/admin/projects/${currentProject.key}/types/${key}`);
    }}
  />
{/if}
