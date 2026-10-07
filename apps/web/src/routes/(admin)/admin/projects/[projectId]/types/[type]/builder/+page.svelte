<script lang="ts">
  import { untrack } from 'svelte';
  // The builder of one Objektart (v3 `workflows/[workflowId]/builder`). The frame comes from
  // `@ueberblick/builder`; this page brings the draft: opens the document, writes it on Speichern,
  // keeps the view in the address and asks before leaving with unsaved changes.
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    BuilderFrame,
    createBuilderRegistry,
    messages,
    openProject,
    parseView,
    registerTaskPane,
    registerFieldPane,
    registerModelView,
    registerCanvas,
    registerStagePane,
    registerRulePane,
    registerTypeSettingsPane,
    registerFormEditor,
    registerCodeView,
    registerEntityYaml,
    setCanvasLayoutApi,
    withView,
    type BuilderView,
    type SaveOutcome,
  } from '@ueberblick/builder';
  import NoDraft from '../../../../../../../(builder)/NoDraft.svelte';
  import { createLayoutClient } from '$lib/admin/draft/layout-client';
  import { createDraftSaver, type PutOutcome, type SaveState } from '$lib/admin/draft/draft-saver';
  import { notifyDraftChanged } from '$lib/admin/draft/status-store.svelte';
  import { deployOverview } from '$lib/admin/deploy/overview-store.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // The admin layout's language (`ub_locale`); the layout remounts this page on a switch.
  const locale = $derived(data.locale);
  const t = $derived(messages(locale));
  // Later work packages register their views and inspectors here (canvas, matrix, code, inspectors).
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  registerFieldPane(registry);
  registerCanvas(registry);
  registerStagePane(registry);
  registerRulePane(registry);
  // The toolbar's gear: the Objektart's own settings in the right pane (v3's Workflow-Einstellungen, WP-437).
  registerTypeSettingsPane(registry);
  registerModelView(registry);
  registerFormEditor(registry);
  registerCodeView(registry);
  // The Formular | YAML toggle on the inspectors (the registry wraps at lookup: any order).
  registerEntityYaml(registry);
  // Where the admin dragged the canvas nodes: stored next to the draft, not in it (WP-366).
  setCanvasLayoutApi(
    createLayoutClient({ project: untrack(() => data.project), fetch: (input, init) => fetch(input, init) }),
  );
  // "Standardfilter & Marker-Symbole" lives on the Objektart's data page (the icon designer): the pane links there.
  const links = $derived({
    icons: `/admin/projects/${encodeURIComponent(page.params.projectId ?? '')}/types/${encodeURIComponent(data.type)}`,
  });
  const doc = $derived(data.draft ? openProject(data.draft.templateSrc, data.draft.overlaySrc) : null);
  const view = $derived(parseView(page.url.searchParams.get('view')));
  let dirty = false;
  let last: SaveState = 'saved';

  async function put(overlay: string, revision: number): Promise<PutOutcome> {
    try {
      const res = await fetch(`/builder-api/${data.project}/draft`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ overlay, revision }),
      });
      if (res.status === 409) return { kind: 'stale' };
      if (!res.ok) return { kind: 'failed' };
      return { kind: 'saved', revision: ((await res.json()) as { revision: number }).revision };
    } catch {
      return { kind: 'failed' };
    }
  }

  // One saver per opened draft: a reload (or a new revision from the server) starts a fresh one.
  const saver = $derived(
    data.draft
      ? createDraftSaver({
          revision: data.draft.revision,
          put,
          onstate: (s) => {
            last = s;
            if (s === 'saved') notifyDraftChanged(); // the shell's publish bar follows the saved draft
          },
        })
      : null,
  );

  async function onsave(overlay: string): Promise<SaveOutcome> {
    if (saver === null) return 'failed';
    saver.save(overlay);
    await saver.settled();
    return last === 'saved' ? 'saved' : last === 'conflict' ? 'conflict' : 'failed';
  }

  // "Gehe zu" of the deploy overview arrives as `?select=<key path>`: the frame selects that element, then the address is clean again.
  const select = $derived(page.url.searchParams.get('select'));
  function onfocused(): void {
    const next = new URL(page.url);
    next.searchParams.delete('select');
    void goto(`${next.pathname}${next.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

  function onviewchange(next: BuilderView): void {
    void goto(withView(page.url.search, next), { replaceState: true, keepFocus: true, noScroll: true });
  }

  // Leaving with unsaved changes asks first (v3 did not; register a3 bugs 1 and 2). A view switch stays on this page.
  // A language switch (WP-394) is a navigation to the same address: it remounts the page, so it asks too.
  beforeNavigate(({ cancel, to, willUnload }) => {
    if (!dirty) return;
    if (willUnload) cancel();
    else if (to !== null && (to.url.pathname !== page.url.pathname || to.url.href === page.url.href)) {
      if (!confirm(t('frame_unsaved_confirm'))) cancel();
    }
  });
</script>

<svelte:head><title>{t('page_title', { page: data.type })}</title></svelte:head>

{#if doc}
  <div class="host">
    <!-- A sub-process link goes to another Objektart on the same route: the frame starts fresh for it. -->
    {#key data.type}
      <BuilderFrame
        {doc}
        type={data.type}
        {locale}
        {registry}
        {view}
        {onviewchange}
        {onsave}
        ondirty={(d) => (dirty = d)}
        ondeploy={() => deployOverview.show()}
        focusTarget={select}
        {onfocused}
        typeHref={(type) => `/admin/projects/${data.project}/types/${type}/builder`}
        {links}
      />
    {/key}
  </div>
{:else}
  <NoDraft project={data.project} {locale} />
{/if}

<style>
  /* The admin shell's content area scrolls and already sits under the header and the publish bar, so the host fills
     it instead of being a viewport tall (it was 100dvh: the page scrolled and the toolbar slid under the bar). */
  .host {
    height: 100%;
    min-height: 0;
  }
</style>
