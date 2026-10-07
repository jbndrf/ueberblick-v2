<script lang="ts">
  // v3 `PermissionsMatrixView.svelte` header and legend: the title, the "Private Instanzen" switch (only the
  // creator sees an object), the Einfach / Erweitert buttons, and the legend of the cell icons.
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Pencil from '@lucide/svelte/icons/pencil';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import type { Translate } from '../../../shell/messages';
  import type { Density } from './model';
  import type { PrivateState } from './ops';

  interface Props {
    t: Translate;
    density: Density;
    ondensity: (density: Density) => void;
    privateState: PrivateState;
    /** The `visible_when` text while it is a custom one. */
    customWhen?: string | undefined;
    onprivate: (on: boolean) => void;
  }
  let { t, density, ondensity, privateState, customWhen, onprivate }: Props = $props();
  const custom = $derived(privateState === 'custom');
</script>

<div class="header">
  <div class="heading">
    <h2>{t('matrix_title')}</h2>
    <p>{t('matrix_description')}</p>
  </div>
  <div class="controls">
    <label
      class="private"
      title={custom ? t('matrix_private_custom', { when: customWhen ?? '' }) : t('matrix_private_hint')}
    >
      <Switch
        checked={privateState === 'on'}
        disabled={custom}
        onCheckedChange={onprivate}
        data-testid="matrix-private"
      />
      {t('matrix_private')}
    </label>
    <div class="density" role="group" aria-label={t('matrix_density')}>
      <Button
        variant={density === 'basic' ? 'default' : 'outline'}
        size="sm"
        aria-pressed={density === 'basic'}
        onclick={() => ondensity('basic')}
      >
        {t('matrix_density_basic')}
      </Button>
      <Button
        variant={density === 'advanced' ? 'default' : 'outline'}
        size="sm"
        aria-pressed={density === 'advanced'}
        onclick={() => ondensity('advanced')}
      >
        {t('matrix_density_advanced')}
      </Button>
    </div>
  </div>
</div>
{#if custom}
  <p class="custom" role="status">{t('matrix_private_custom', { when: customWhen ?? '' })}</p>
{/if}

<div class="legend">
  <span class="item"><Eye class="ok" />{t('matrix_legend_allowed')}</span>
  <span class="item"><Pencil class="ok" />{t('matrix_legend_write')}</span>
  <span class="item">
    <span class="dashed"><Eye class="ok" /></span>
    {t('matrix_legend_all')}
  </span>
  <span class="item"><EyeOff class="no" />{t('matrix_legend_denied')}</span>
  <span class="item"><RotateCcw class="mod" />{t('matrix_legend_modified')}</span>
</div>

<style>
  .header {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .heading {
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
  }
  p {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }
  .private {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
  }
  .density {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .custom {
    padding: 0.375rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--muted);
  }
  .legend {
    display: flex;
    flex-shrink: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 1rem;
    padding: 0.375rem 1rem;
    border-bottom: 1px solid var(--border);
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  .legend :global(svg) {
    height: 0.875rem;
    width: 0.875rem;
  }
  .legend :global(.ok) {
    color: var(--matrix-allowed, #16a34a);
  }
  .legend :global(.no) {
    color: color-mix(in oklab, var(--destructive) 40%, transparent);
  }
  .legend :global(.mod) {
    color: var(--primary);
  }
  .dashed {
    display: inline-flex;
    height: 1.25rem;
    width: 1.25rem;
    align-items: center;
    justify-content: center;
    border: 1px dashed color-mix(in oklab, var(--matrix-allowed, #16a34a) 40%, transparent);
    border-radius: 0.25rem;
  }
  .dashed :global(svg) {
    height: 0.75rem;
    width: 0.75rem;
  }
</style>
