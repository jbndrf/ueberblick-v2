<script lang="ts">
  // v3 `WorkflowCodeView.svelte`: the middle of the builder when "Code" is chosen: the whole Objektart as
  // YAML (here: the type, its tasks and its rules, in the template file's shape) with Kopieren, Neu laden
  // and Übernehmen, and reference completion. Edits become overlay ops through the Doc (`applyTypeYaml`).
  // Register Q7 a: a second tab "Anpassungen" shows the raw overlay of this Objektart (read-only); a project
  // on an empty template has nothing to differ from, so it shows no tabs.
  import { applyTypeYaml, provenanceLines, typeYaml } from '../../doc';
  import { getBuilderContext } from '../shell/context';
  import OverlayTab from './OverlayTab.svelte';
  import YamlPanel from './YamlPanel.svelte';
  import { hasTemplateContent, overlayYaml } from './overlay';
  import { refSources } from './refs';
  import { scopeOf } from './scope';

  const ctx = getBuilderContext();
  const t = ctx.t;
  const doc = $derived(ctx.doc());
  const scope = $derived(scopeOf(doc, ctx.type, ctx.locale));
  const source = $derived(scope === undefined ? '' : typeYaml(doc, scope).text);
  const sources = $derived(refSources(doc, ctx.type, ctx.locale));

  const TABS = ['code', 'overlay'] as const;
  type Tab = (typeof TABS)[number];
  let tab = $state<Tab>('code');
  // Only computed while the tab is open: it parses the template once more to find the template's own scope.
  const overlay = $derived(tab === 'overlay' ? overlayYaml(doc, ctx.type, ctx.locale) : undefined);
  const hasTabs = $derived(hasTemplateContent(doc));
  const tabLabel = { code: () => t('code_tab_code'), overlay: () => t('code_tab_overlay') };
</script>

{#if scope === undefined}
  <p class="empty">{t('code_scope_empty')}</p>
{:else}
  <div class="view">
    {#if hasTabs}
      <div class="tabs" role="tablist" aria-label={t('code_tabs')}>
        {#each TABS as key (key)}
          <button
            type="button"
            role="tab"
            aria-selected={tab === key}
            class="tab-btn"
            class:active={tab === key}
            data-testid={`code-tab-${key}`}
            onclick={() => (tab = key)}
          >
            {tabLabel[key]()}
          </button>
        {/each}
      </div>
    {/if}
    {#if tab === 'overlay' && hasTabs}
      <OverlayTab {ctx} text={overlay ?? ''} />
    {/if}
    <!-- Kept mounted behind the other tab: typed, not yet applied text survives a look at the overlay. -->
    <div class="pane" hidden={tab === 'overlay' && hasTabs}>
      <YamlPanel
        {ctx}
        testid="code-view"
        hint={t('code_hint')}
        {source}
        check={(text) => applyTypeYaml(doc, scope, text)}
        marks={(text) => provenanceLines(doc, text).map((l) => l.provenance)}
        {sources}
      />
    </div>
  </div>
{/if}

<style>
  .view {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .pane[hidden] {
    display: none;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.375rem 0.5rem;
    overflow-x: auto;
    font-size: 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .tab-btn {
    flex-shrink: 0;
    padding: 0.25rem 0.5rem;
    color: var(--muted-foreground);
    background: transparent;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
  }
  .tab-btn:hover {
    color: var(--foreground);
  }
  .tab-btn.active {
    font-weight: 500;
    color: var(--foreground);
    background: var(--accent);
  }
  .empty {
    margin: 1rem;
    font-size: 0.8125rem;
    font-style: italic;
    color: var(--muted-foreground);
  }
  @media (max-width: 640px) {
    .tab-btn {
      padding: 0.5rem 0.75rem;
      font-size: 0.875rem;
    }
  }
</style>
