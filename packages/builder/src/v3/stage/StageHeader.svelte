<script lang="ts">
  // The header of v3's participant preview (`ParticipantPreview.svelte:78-157`): in the participant's
  // primary colour, the stage name edited in place (or the "Standardansicht" title), the type, the
  // role of the preview, delete and close. It edits nothing itself; the pane applies the ops.
  import Layers from '@lucide/svelte/icons/layers';
  import Lock from '@lucide/svelte/icons/lock';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import type { Translate } from '../../shell/messages';
  import InlineEdit from '../shared/InlineEdit.svelte';
  import ProvenanceMark from '../shared/ProvenanceMark.svelte';
  import type { ProvenanceInfo } from '../shared/provenance';
  import { STAGE_TYPES, type StageType } from './ops';
  import { ALL_ROLES, type PreviewRole } from './preview';

  interface Props {
    t: Translate;
    /** The selected stage; null is the "Standardansicht". */
    stage: string | null;
    name: string;
    stageType: StageType;
    role: string;
    roles: readonly PreviewRole[];
    /** Why the template locks the stage; undefined when it is free. */
    lock: string | undefined;
    /** Where the stage comes from (WP-480, as the rule pane); undefined in a project without a template. */
    info: ProvenanceInfo | undefined;
    /** The delete of a template stage is a hide. */
    hide: boolean;
    /** Offered for a changed stage. */
    canReset: boolean;
    onreset: () => void;
    onrename: (text: string) => void;
    ontype: (event: Event & { currentTarget: HTMLSelectElement }) => void;
    onrole: (role: string) => void;
    ondelete: () => void;
    onclose: () => void;
  }
  let {
    t,
    stage,
    name,
    stageType,
    role,
    roles,
    lock,
    info,
    hide,
    canReset,
    onreset,
    onrename,
    ontype,
    onrole,
    ondelete,
    onclose,
  }: Props = $props();

  const typeLabels: Record<StageType, () => string> = {
    start: () => t('stage_type_start'),
    intermediate: () => t('stage_type_intermediate'),
    end: () => t('stage_type_end'),
  };
</script>

<header class="head">
  <div class="title">
    {#if stage !== null}
      <InlineEdit
        class="name"
        value={name}
        oncommit={onrename}
        ariaLabel={t('stage_name')}
        editTitle={t('stage_edit_name')}
        disabled={lock !== undefined}
      />
      {#if lock !== undefined}
        <span class="lock" title={t('stage_locked')} data-testid="stage-locked">
          <Lock aria-label={t('stage_locked')} />
        </span>
      {/if}
    {:else}
      <Layers class="layers" />
      <div class="default">
        <div class="name-static">{t('stage_default_title')}</div>
        <div class="hint">{t('stage_default_hint')}</div>
      </div>
    {/if}
  </div>

  <div class="controls">
    {#if stage !== null}
      <select
        class="select"
        value={stageType}
        title={t('stage_type')}
        aria-label={t('stage_type')}
        data-testid="stage-type"
        onchange={ontype}
      >
        {#each Object.values(STAGE_TYPES) as key (key)}
          <option value={key}>{typeLabels[key]()}</option>
        {/each}
      </select>
    {/if}
    <select
      class="select"
      value={role}
      aria-label={t('stage_role')}
      data-testid="stage-role"
      onchange={(e) => onrole(e.currentTarget.value)}
    >
      <option value={ALL_ROLES}>{t('stage_all_roles')}</option>
      {#each roles as r (r.key)}
        <option value={r.key}>{r.label}</option>
      {/each}
    </select>
    {#if stage !== null}
      <button
        type="button"
        class="icon"
        disabled={lock !== undefined}
        title={hide ? t('prov_hide') : t('stage_delete')}
        aria-label={hide ? t('prov_hide') : t('stage_delete')}
        data-testid="stage-delete"
        onclick={ondelete}
      >
        <Trash2 />
      </button>
    {/if}
    <button
      type="button"
      class="icon"
      aria-label={t('stage_close')}
      data-testid="stage-close"
      onclick={onclose}
    >
      <X />
    </button>
  </div>
  {#if stage !== null && info !== undefined}
    <div class="prov" data-testid="stage-provenance">
      <ProvenanceMark {t} {info} />
      {#if canReset}
        <button
          type="button"
          class="reset"
          data-testid="stage-reset"
          disabled={lock !== undefined}
          title={info.lock === undefined ? undefined : t('prov_locked', { lock: info.lock })}
          onclick={onreset}>{t('prov_reset')}</button
        >
      {/if}
    </div>
  {/if}
</header>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 1rem;
    background: var(--primary);
    color: var(--primary-foreground);
    border-bottom: 1px solid var(--border);
    border-radius: 0.75rem 0.75rem 0 0;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1 1 8rem;
    min-width: 0;
  }
  .title :global(.name) {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0;
    border: 0;
    border-bottom: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 1.125rem;
    font-weight: 600;
    text-align: left;
    outline: none;
  }
  .title :global(button.name) {
    cursor: text;
  }
  .title :global(button.name:hover) {
    opacity: 0.8;
  }
  .title :global(input.name:focus) {
    border-bottom-color: color-mix(in srgb, var(--primary-foreground) 40%, transparent);
  }
  .lock :global(svg),
  .title :global(.layers) {
    width: 1rem;
    height: 1rem;
    opacity: 0.8;
  }
  .name-static {
    font-size: 1.125rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hint {
    font-size: 0.75rem;
    opacity: 0.7;
  }
  .prov {
    display: flex;
    flex: 1 0 100%;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .reset {
    min-height: 2rem;
    padding: 0 0.5rem;
    border: 1px solid color-mix(in srgb, var(--primary-foreground) 40%, transparent);
    border-radius: 0.25rem;
    background: transparent;
    color: inherit;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .reset:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-left: auto;
  }
  .select {
    min-height: 2rem;
    max-width: 10rem;
    padding: 0.25rem 0.5rem;
    border: 0;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--primary-foreground) 10%, transparent);
    color: var(--primary-foreground);
    font-size: 0.75rem;
    cursor: pointer;
    outline: none;
  }
  .select option {
    color: var(--foreground);
    background: var(--background);
  }
  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    min-height: 2rem;
    padding: 0.5rem;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: background 0.15s;
  }
  .icon:hover:not(:disabled) {
    background: color-mix(in srgb, var(--primary-foreground) 10%, transparent);
  }
  .icon:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .icon :global(svg) {
    width: 1rem;
    height: 1rem;
  }
</style>
