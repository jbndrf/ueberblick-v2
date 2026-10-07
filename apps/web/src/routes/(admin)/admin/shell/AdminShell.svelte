<script lang="ts">
  // The admin shell (v3 `+layout.svelte:577-650`): sidebar, 40 px header with trigger and account menu, page content.
  // All inputs arrive as props; `+layout.svelte` binds them to the route.
  import type { Snippet } from 'svelte';
  import * as Sidebar from '@ueberblick/ui/components/ui/sidebar';
  import AccountMenu, { type Theme } from './AccountMenu.svelte';
  import CloseOnNavigate from './CloseOnNavigate.svelte';
  import AdminSidebar from './AdminSidebar.svelte';
  import { adminMessage } from './messages';
  import type { Locale } from './locale';
  import type { ShellProject } from './nav';
  import type { SidebarType } from './sidebar-types';
  import PublishBar from '../../../../lib/admin/draft/PublishBar.svelte';
  import { builderHref } from '../../../../lib/admin/draft/publish-client';
  import { createDeployClient } from '../../../../lib/admin/deploy/deploy-client';
  import DeployOverview from '../../../../lib/admin/deploy/DeployOverview.svelte';
  import type { Blocker } from '../../../../lib/admin/deploy/types';
  import { draftStatus } from '../../../../lib/admin/draft/status-store.svelte';

  let {
    locale,
    pathname,
    account,
    projects,
    currentProject,
    types = [],
    navigate = () => undefined,
    refresh = async () => undefined,
    theme,
    onTheme,
    onLocale,
    onSignOut,
    draftFetch,
    children,
  }: {
    locale: Locale;
    pathname: string;
    account: { email: string } | null;
    projects: readonly ShellProject[];
    currentProject: ShellProject | null;
    /** The open project's types for the sidebar groups (from its draft). */
    types?: readonly SidebarType[];
    /** Opens a page (the new type's builder). */
    navigate?: (href: string) => void;
    /** Reads the shell's data again after the sidebar changed the draft. */
    refresh?: () => Promise<void>;
    theme: Theme;
    onTheme: (theme: Theme) => void;
    onLocale: (locale: Locale) => void;
    onSignOut: () => void;
    /** `fetch` for the draft status and the publish call (the browser's own unless a test passes one). */
    draftFetch?: typeof fetch | undefined;
    children: Snippet;
  } = $props();

  // The draft state of the open project (WP-326): read again when the project or the page changes, and when an
  // admin page reports a saved draft (`notifyDraftChanged`). Outside a project there is no draft.
  $effect(() => {
    void pathname;
    void draftStatus.changes;
    const key = currentProject?.key;
    if (key) void draftStatus.refresh(key, draftFetch);
    else draftStatus.clear();
  });
  /** "Gehe zu" of a blocker: the builder of its Objektart, which selects the element (`?select=`, register a3 row 97). */
  function gotoBlocker(project: string, b: Blocker): void {
    const href = builderHref(project, b.type);
    navigate(b.type === null ? href : `${href}?select=${encodeURIComponent(b.path)}`);
  }
  const barStatus = $derived(
    currentProject && draftStatus.project === currentProject.key ? draftStatus.status : null,
  );
</script>

<Sidebar.Provider>
  <CloseOnNavigate {pathname} />
  <Sidebar.Root
    srTitle={adminMessage(locale, 'sidebar_title')}
    srDescription={adminMessage(locale, 'sidebar_description')}
  >
    <AdminSidebar {locale} {pathname} {projects} {currentProject} {types} {navigate} {refresh} {draftFetch} />
  </Sidebar.Root>

  <Sidebar.Inset class="max-h-svh">
    <header class="sticky top-0 z-10 flex h-10 items-center gap-2 border-b bg-background px-3">
      <Sidebar.Trigger label={adminMessage(locale, 'sidebar_toggle')} />
      <div class="flex-1"></div>
      <div class="flex items-center gap-3">
        {#if account}
          <AccountMenu {locale} email={account.email} {theme} {onTheme} {onLocale} {onSignOut} />
        {/if}
      </div>
    </header>
    {#if currentProject}
      <PublishBar {locale} project={currentProject.key} status={barStatus} />
      <DeployOverview
        {locale}
        client={createDeployClient({ project: currentProject.key, fetch: draftFetch ?? fetch })}
        ongoto={(b) => gotoBlocker(currentProject.key, b)}
        onpublished={() => void draftStatus.refresh(currentProject.key, draftFetch)}
      />
    {/if}
    <div class="min-h-0 flex-1 overflow-y-auto p-3">{@render children()}</div>
  </Sidebar.Inset>
</Sidebar.Provider>
