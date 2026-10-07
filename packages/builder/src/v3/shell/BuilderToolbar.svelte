<script lang="ts">
  // The toolbar of the builder frame (v3 `builder/+page.svelte`): Speichern, the view switch
  // Workflow · Modell · Code, the problems badge, the unsaved mark, the notice and the name.
  // On a phone it also holds the buttons that open the catalog and inspector sheets.
  import CodeXml from '@lucide/svelte/icons/code-xml';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Settings from '@lucide/svelte/icons/settings';
  import Save from '@lucide/svelte/icons/save';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Rocket from '@lucide/svelte/icons/rocket';
  import PanelLeft from '@lucide/svelte/icons/panel-left';
  import PanelRight from '@lucide/svelte/icons/panel-right';
  import type { Component } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { ProblemItem } from '../../problems/model';
  import type { Translate } from '../../shell/messages';
  import ProblemsBadge from './ProblemsBadge.svelte';
  import { BUILDER_VIEWS, type BuilderView } from './registry';
  import type { SaveOutcome } from './context';

  interface Props {
    t: Translate;
    view: BuilderView;
    viewLabels: Record<BuilderView, () => string>;
    phone: boolean;
    saving: boolean;
    canSave: boolean;
    dirty: boolean;
    outcome: SaveOutcome | undefined;
    refusal: string;
    items: ProblemItem[];
    typeLabel: string;
    catalogOpen: boolean;
    inspectorOpen: boolean;
    onsave: () => void;
    /** "Veröffentlichen" (WP-360): shown when the host has a deploy overview. */
    ondeploy?: (() => void) | undefined;
    onsetview: (view: BuilderView) => void;
    /** The gear (v3 `ui.select({ type: 'workflow' })`): the Objektart's own settings in the right pane. */
    onsettings: () => void;
    onfocusproblem: (item: ProblemItem) => void;
    oncommitname: (event: Event & { currentTarget: HTMLInputElement }) => void;
  }
  let {
    t,
    view,
    viewLabels,
    phone,
    saving,
    canSave,
    dirty,
    outcome,
    refusal,
    items,
    typeLabel,
    catalogOpen = $bindable(),
    inspectorOpen = $bindable(),
    onsave,
    ondeploy,
    onsetview,
    onsettings,
    onfocusproblem,
    oncommitname,
  }: Props = $props();

  const viewIcons: Record<BuilderView, Component> = { workflow: Workflow, model: ShieldCheck, code: CodeXml };
</script>

<div class="toolbar" role="toolbar" aria-label={t('frame_name')}>
  <div class="toolbar-left">
    {#if phone && view !== 'code'}
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        data-testid="open-catalog"
        onclick={() => (catalogOpen = true)}
      >
        <PanelLeft />
        {t('catalog_label')}
      </Button>
    {/if}
    <Button size="sm" onclick={onsave} disabled={saving || !canSave}>
      {#if saving}
        <LoaderCircle class="animate-spin" />
        {t('frame_saving')}
      {:else}
        <Save />
        {t('frame_save')}
      {/if}
    </Button>

    {#if ondeploy !== undefined}
      <Button variant="outline" size="sm" data-testid="deploy" onclick={ondeploy}>
        <Rocket />
        {t('frame_publish')}
      </Button>
    {/if}

    <div class="view-toggle" role="group" aria-label={t('frame_views')}>
      {#each BUILDER_VIEWS as key (key)}
        {@const Icon = viewIcons[key]}
        <Button
          variant={view === key ? 'default' : 'outline'}
          size="sm"
          aria-pressed={view === key}
          onclick={() => onsetview(key)}
        >
          <Icon />
          {viewLabels[key]()}
        </Button>
      {/each}
    </div>

    <Button
      variant="outline"
      size="sm"
      title={t('frame_type_settings')}
      aria-label={t('frame_type_settings')}
      data-testid="type-settings"
      onclick={onsettings}
    >
      <Settings />
    </Button>

    <ProblemsBadge {items} {t} onselect={onfocusproblem} />

    {#if phone && view !== 'code'}
      <Button
        variant="outline"
        size="sm"
        aria-haspopup="dialog"
        data-testid="open-inspector"
        onclick={() => (inspectorOpen = true)}
      >
        <PanelRight />
        {t('frame_inspector')}
      </Button>
    {/if}

    <!-- Always laid out (hidden while saved), so the first edit does not move the canvas below the toolbar. -->
    <span
      class="unsaved"
      class:saved={!dirty}
      data-testid={dirty ? 'unsaved' : undefined}
      aria-hidden={!dirty}>{t('frame_unsaved')}</span
    >
    <span class="notice" role="alert">
      {#if outcome === 'conflict'}{t('save_conflict')}
      {:else if outcome === 'failed'}{t('frame_save_failed')}
      {:else}{refusal}{/if}
    </span>
  </div>

  <div class="toolbar-right">
    <Input
      class="h-8 w-64"
      value={typeLabel}
      aria-label={t('frame_name')}
      data-testid="type-name"
      onchange={oncommitname}
    />
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    gap: 1rem;
    flex-shrink: 0;
    background: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .toolbar-left,
  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .view-toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .unsaved {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .unsaved.saved {
    visibility: hidden;
  }
  .notice {
    font-size: 0.75rem;
    color: var(--destructive);
  }
  /* Phone (same 768 px as the kit's IsMobile): the toolbar wraps, the name takes its own line, the sheets hold the panes. */
  @media (max-width: 767px) {
    .toolbar {
      flex-wrap: wrap;
      padding: 0.5rem;
      gap: 0.5rem;
    }
    .toolbar-right {
      width: 100%;
    }
    .toolbar-right :global(input) {
      width: 100%;
    }
  }
</style>
