<script lang="ts">
  import type { StatusBadgeProps } from '../contract';
  import type { IconDef } from '../contract';
  import type { StatusKind } from '@ueberblick/core/registry';
  import { m } from '../paraglide/messages.js';
  import { iconAlertTriangle, iconCheckCircle, iconClock, iconCloudOff } from '../icons';
  import Icon from './Icon.svelte';

  let { status }: StatusBadgeProps = $props();

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
</script>

<span class="ub-status" data-status={status} role="status">
  <Icon icon={icons[status]} size={20} />
  <span>{texts[status]()}</span>
</span>

<style>
  .ub-status {
    display: inline-flex;
    align-items: center;
    gap: var(--ub-space-sm);
    padding: var(--ub-space-xs) var(--ub-space-md);
    border: 2px solid currentColor;
    border-radius: var(--ub-radius-pill);
    font: var(--ub-type-weight-strong) var(--ub-type-size-sm) / var(--ub-type-line-height)
      var(--ub-type-family);
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
</style>
