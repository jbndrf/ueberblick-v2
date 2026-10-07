<script lang="ts">
  import { ME_SECTIONS } from '@ueberblick/core/registry';
  import type { MeSection } from '@ueberblick/core/registry';
  import type { AppShellProps } from './contract';
  import { m } from '../paraglide/messages.js';
  import { TARGET_SIZE } from '../tokens';
  import Sheet from '../components/Sheet.svelte';
  import StatusIndicator from './StatusIndicator.svelte';

  let {
    model,
    status,
    onexport,
    featureId = null,
    onfeatureclose,
    map,
    featureSheet,
    taskSheet,
    me,
    assistant,
    ontask,
    ontool,
  }: AppShellProps = $props();

  type Area = 'map' | 'me';
  let area: Area = $state('map');
  let picked: string | null = $state(null);
  let meSection: MeSection = $state('profile');
  let pickerOpen = $state(false);
  let taskKey: string | null = $state(null);
  let mainEl: HTMLElement | undefined = $state();

  const viewKey = $derived(
    picked !== null && model.views.some((v) => v.key === picked) ? picked : model.home,
  );
  const taskLabel = $derived(model.tasks.find((t) => t.key === taskKey)?.label ?? '');

  const meLabels: Record<MeSection, () => string> = {
    profile: m.ui_shell_me_profile,
    settings: m.ui_shell_me_settings,
    offline_packs: m.ui_shell_me_offline_packs,
  };

  function startTask(key: string) {
    pickerOpen = false;
    taskKey = key;
    ontask?.(key);
  }

  function skip(e: MouseEvent) {
    e.preventDefault();
    mainEl?.focus();
  }
</script>

<div class="ub-shell" data-theme={model.theme}>
  <a class="skip" href="#ub-main" onclick={skip}>{m.ui_shell_skip()}</a>

  <header>
    <StatusIndicator {status} {onexport} />
  </header>

  <main id="ub-main" bind:this={mainEl} tabindex="-1">
    {#if area === 'map'}
      {#if model.views.length > 0}
        <div class="bar" role="group" aria-label={m.ui_shell_views()}>
          {#each model.views as v (v.key)}
            <button
              type="button"
              class="chip"
              aria-pressed={v.key === viewKey}
              style:min-height="{TARGET_SIZE.other}px"
              onclick={() => (picked = v.key)}>{v.label}</button
            >
          {/each}
        </div>
      {/if}
      {#if model.tools.length > 0}
        <div class="bar" role="group" aria-label={m.ui_shell_tools()}>
          {#each model.tools as t (t.key)}
            <button
              type="button"
              class="chip"
              style:min-height="{TARGET_SIZE.other}px"
              onclick={() => ontool?.(t.key)}>{t.label}</button
            >
          {/each}
        </div>
      {/if}
      {#if viewKey === null}
        <p class="empty">{m.ui_shell_no_views()}</p>
      {:else}
        <div class="map">{@render map({ viewKey })}</div>
      {/if}
      <div class="actions">
        {#if model.shortcuts.length > 0}
          <div class="bar" role="group" aria-label={m.ui_shell_shortcuts()}>
            {#each model.shortcuts as s (s.key)}
              <button
                type="button"
                class="primary"
                style:min-height="{TARGET_SIZE.primary}px"
                onclick={() => startTask(s.key)}>{s.label}</button
              >
            {/each}
          </div>
        {/if}
        {#if model.tasks.length > 0}
          <button
            type="button"
            class="primary"
            style:min-height="{TARGET_SIZE.primary}px"
            aria-haspopup="dialog"
            onclick={() => (pickerOpen = true)}
            ><span aria-hidden="true">+</span> {m.ui_shell_new_task()}</button
          >
        {/if}
      </div>
    {:else}
      <div class="bar" role="group" aria-label={m.ui_shell_me_sections()}>
        {#each ME_SECTIONS.keys as s (s)}
          <button
            type="button"
            class="chip"
            aria-pressed={s === meSection}
            style:min-height="{TARGET_SIZE.other}px"
            onclick={() => (meSection = s)}>{meLabels[s]()}</button
          >
        {/each}
      </div>
      {#if me}{@render me({ section: meSection })}{/if}
    {/if}
  </main>

  {#if assistant}
    <aside data-slot="assistant" aria-label={m.ui_shell_assistant()}>{@render assistant()}</aside>
  {/if}

  <nav aria-label={m.ui_shell_nav()}>
    <button
      type="button"
      aria-current={area === 'map' ? 'page' : undefined}
      style:min-height="{TARGET_SIZE.primary}px"
      onclick={() => (area = 'map')}>{m.ui_shell_area_map()}</button
    >
    <button
      type="button"
      aria-current={area === 'me' ? 'page' : undefined}
      style:min-height="{TARGET_SIZE.primary}px"
      onclick={() => (area = 'me')}>{m.ui_shell_area_me()}</button
    >
  </nav>

  <Sheet open={pickerOpen} title={m.ui_shell_pick_task()} onclose={() => (pickerOpen = false)}>
    <ul class="picker">
      {#each model.tasks as t (t.key)}
        <li>
          <button
            type="button"
            class="primary"
            style:min-height="{TARGET_SIZE.primary}px"
            onclick={() => startTask(t.key)}>{t.label}</button
          >
        </li>
      {/each}
    </ul>
  </Sheet>

  <Sheet open={taskKey !== null} title={taskLabel} onclose={() => (taskKey = null)}>
    {#if taskKey !== null}{@render taskSheet({ taskKey })}{/if}
  </Sheet>

  {#if featureSheet && featureId !== null}
    <Sheet open={true} title={m.ui_shell_feature()} onclose={() => onfeatureclose?.()}>
      {@render featureSheet({ featureId })}
    </Sheet>
  {/if}
</div>

<style>
  .ub-shell {
    display: grid;
    grid-template-rows: auto 1fr auto;
    min-height: 100dvh;
    background: var(--ub-color-bg);
    color: var(--ub-color-text);
    font: var(--ub-type-weight-normal) var(--ub-type-size-md) / var(--ub-type-line-height)
      var(--ub-type-family);
  }
  header {
    display: flex;
    justify-content: flex-end;
    padding: var(--ub-space-sm) var(--ub-space-md);
    border-bottom: 2px solid var(--ub-color-border);
  }
  main {
    display: flex;
    flex-direction: column;
    gap: var(--ub-space-sm);
    padding: var(--ub-space-sm) var(--ub-space-md);
    min-height: 0;
  }
  main:focus {
    outline: none;
  }
  .map {
    flex: 1;
    min-height: 0;
  }
  .empty {
    color: var(--ub-color-text-muted);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ub-space-sm);
  }
  .actions {
    display: grid;
    gap: var(--ub-space-sm);
  }
  .picker {
    list-style: none;
    margin: var(--ub-space-md) 0 0;
    padding: 0;
    display: grid;
    gap: var(--ub-space-sm);
  }
  button {
    font: inherit;
    font-weight: var(--ub-type-weight-strong);
    cursor: pointer;
    border-radius: var(--ub-radius-md);
    border: 2px solid var(--ub-color-primary);
    padding: 0 var(--ub-space-md);
    min-width: 44px;
  }
  button:focus-visible,
  .skip:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: 2px;
  }
  .chip {
    background: var(--ub-color-bg);
    color: var(--ub-color-primary);
  }
  .chip[aria-pressed='true'] {
    background: var(--ub-color-primary);
    color: var(--ub-color-on-primary);
  }
  .primary {
    background: var(--ub-color-primary);
    color: var(--ub-color-on-primary);
    min-width: 56px;
  }
  nav {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border-top: 2px solid var(--ub-color-border);
    background: var(--ub-color-surface);
  }
  nav button {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--ub-color-text);
    min-width: 56px;
  }
  nav button[aria-current='page'] {
    box-shadow: inset 0 -4px 0 var(--ub-color-primary);
  }
  .skip {
    position: absolute;
    left: var(--ub-space-md);
    top: var(--ub-space-md);
    padding: var(--ub-space-sm) var(--ub-space-md);
    background: var(--ub-color-primary);
    color: var(--ub-color-on-primary);
    transform: translateY(-200%);
  }
  .skip:focus {
    transform: none;
    z-index: 1;
  }
  aside {
    padding: var(--ub-space-sm) var(--ub-space-md);
  }
</style>
