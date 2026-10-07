<script lang="ts">
  import type { IconDef } from '../contract';
  import type { StatusKind } from '@ueberblick/core/registry';
  import type { StatusIndicatorProps } from './contract';
  import { deriveStatusKind } from './model';
  import { m } from '../paraglide/messages.js';
  import { getLocale } from '../paraglide/runtime.js';
  import { iconAlertTriangle, iconCheckCircle, iconClock, iconCloudOff } from '../icons';
  import { TARGET_SIZE } from '../tokens';
  import Icon from '../components/Icon.svelte';
  import Sheet from '../components/Sheet.svelte';
  import Button from '../components/Button.svelte';

  let { status, onexport }: StatusIndicatorProps = $props();

  // Icon shape and text carry the meaning; colour only reinforces it (docs/13 principles 8 and 9).
  const icons: Record<StatusKind, IconDef> = {
    online: iconCheckCircle,
    offline: iconCloudOff,
    pending: iconClock,
    refused: iconAlertTriangle,
  };
  const texts: Record<StatusKind, () => string> = {
    online: m.ui_status_online,
    offline: m.ui_status_offline,
    pending: m.ui_status_pending,
    refused: m.ui_status_refused,
  };

  let open = $state(false);
  const kind = $derived(deriveStatusKind(status));
  const atRisk = $derived(status.storage === 'at_risk');
  // The kind text "Waiting to sync" would repeat the count, so pending shows only the count.
  const showKind = $derived(kind !== 'pending');
  const canExport = $derived(atRisk || status.pending > 0);
  const lastSynced = $derived(
    status.lastSyncedAt === null
      ? m.ui_shell_never_synced()
      : m.ui_shell_last_synced({
          time: new Intl.DateTimeFormat(getLocale(), { dateStyle: 'short', timeStyle: 'short' }).format(
            new Date(status.lastSyncedAt),
          ),
        }),
  );
</script>

<div class="wrap" role="status">
  <button
    type="button"
    class="ub-status-button"
    data-status={atRisk ? 'refused' : kind}
    style:min-height="{TARGET_SIZE.other}px"
    aria-haspopup="dialog"
    onclick={() => (open = true)}
  >
    <span class="sr">{m.ui_shell_status()}: </span>
    <Icon icon={icons[atRisk ? 'refused' : kind]} size={20} />
    {#if showKind}<span>{texts[kind]()}</span>{/if}
    {#if status.pending > 0}<span>{m.ui_shell_pending({ count: status.pending })}</span>{/if}
    {#if atRisk}<span>{m.ui_shell_data_at_risk()}</span>{/if}
  </button>
</div>

<Sheet {open} title={m.ui_shell_status_details()} onclose={() => (open = false)}>
  <ul class="details">
    <li>
      <Icon icon={icons[status.online ? 'online' : 'offline']} size={20} />
      {status.online ? m.ui_status_online() : m.ui_status_offline()}
    </li>
    <li>{lastSynced}</li>
    {#if status.pending > 0}
      <li>{m.ui_shell_pending({ count: status.pending })}</li>
      {#if status.oldestPendingAge !== null}
        <li>{m.ui_shell_oldest_pending({ minutes: Math.round(status.oldestPendingAge / 60000) })}</li>
      {/if}
    {/if}
  </ul>
  {#if atRisk}<p><strong>{m.ui_shell_data_at_risk()}.</strong> {m.ui_shell_risk_hint()}</p>{/if}
  {#if status.refused.length > 0}
    <h3>{m.ui_shell_refused_title()}</h3>
    <ul class="details">
      {#each status.refused as r (r.runId)}
        <li><code>{r.runId}</code>: {r.reason}</li>
      {/each}
    </ul>
  {/if}
  {#if canExport}
    <Button variant={atRisk ? 'primary' : 'secondary'} onclick={onexport}>{m.ui_shell_export()}</Button>
  {/if}
</Sheet>

<style>
  .ub-status-button {
    display: inline-flex;
    align-items: center;
    gap: var(--ub-space-sm);
    padding: var(--ub-space-xs) var(--ub-space-md);
    border: 2px solid currentColor;
    border-radius: var(--ub-radius-pill);
    font: var(--ub-type-weight-strong) var(--ub-type-size-sm) / var(--ub-type-line-height)
      var(--ub-type-family);
    cursor: pointer;
  }
  .ub-status-button:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: 2px;
  }
  [data-status='online'] {
    color: var(--ub-color-status-online-fg);
    background: var(--ub-color-status-online-bg);
  }
  [data-status='offline'] {
    color: var(--ub-color-status-offline-fg);
    background: var(--ub-color-status-offline-bg);
  }
  [data-status='pending'] {
    color: var(--ub-color-status-pending-fg);
    background: var(--ub-color-status-pending-bg);
  }
  [data-status='refused'] {
    color: var(--ub-color-status-refused-fg);
    background: var(--ub-color-status-refused-bg);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .details {
    list-style: none;
    margin: var(--ub-space-md) 0;
    padding: 0;
    display: grid;
    gap: var(--ub-space-sm);
  }
  h3 {
    margin: var(--ub-space-md) 0 0;
    font-size: var(--ub-type-size-md);
  }
</style>
