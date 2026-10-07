<script lang="ts">
  // v3 `inspector/InspectorHost.svelte:46-62`: every selectable element has a "Formular | YAML" toggle
  // above its inspector; YAML shows `EntityYamlView`. The toggle returns to the form when the selection
  // changes. Without a registered form (an Objektart has none yet) the YAML stands alone.
  import type { Component } from 'svelte';
  import CodeXml from '@lucide/svelte/icons/code-xml';
  import PanelsTopLeft from '@lucide/svelte/icons/panels-top-left';
  import { formatKeyPath } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { getBuilderContext } from '../shell/context';
  import { autoAt } from '../rule/auto-task';
  import EntityYamlView from './EntityYamlView.svelte';

  interface Props {
    /** The inspector this wraps. */
    inner?: Component | undefined;
  }
  let { inner }: Props = $props();

  const ctx = getBuilderContext();
  const t = ctx.t;
  const selection = $derived(ctx.selection());
  const path = $derived.by(() => {
    const { kind, id } = selection;
    if (kind === 'type') return formatKeyPath(['types', ctx.type]);
    if (kind === 'rule' && id !== undefined) return autoAt(id);
    if (kind === 'field' && id !== undefined) return formatKeyPath(['types', ctx.type, 'properties', id]);
    return undefined;
  });

  let yaml = $state(false);
  // Back to the form whenever the selection changes.
  $effect(() => {
    void selection.kind;
    void selection.id;
    yaml = false;
  });
  const Inner = $derived(inner);
</script>

<div class="host" data-testid="yaml-toggled">
  {#if path !== undefined && Inner !== undefined}
    <div class="modes" role="group" aria-label={t('code_modes')}>
      <Button
        variant={yaml ? 'ghost' : 'secondary'}
        size="sm"
        aria-pressed={!yaml}
        data-testid="mode-form"
        onclick={() => (yaml = false)}
      >
        <PanelsTopLeft />
        {t('code_view_form')}
      </Button>
      <Button
        variant={yaml ? 'secondary' : 'ghost'}
        size="sm"
        aria-pressed={yaml}
        data-testid="mode-yaml"
        onclick={() => (yaml = true)}
      >
        <CodeXml />
        {t('code_view_yaml')}
      </Button>
    </div>
  {/if}
  {#if path !== undefined && (yaml || Inner === undefined)}
    {#key path}<EntityYamlView {path} />{/key}
  {:else if Inner !== undefined}
    <Inner />
  {/if}
</div>

<style>
  .host {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .modes {
    display: flex;
    gap: 2px;
    padding: 0.375rem;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--card) 50%, transparent);
  }
</style>
