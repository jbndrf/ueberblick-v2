<script lang="ts">
  import { untrack } from 'svelte';
  // v3 `settings/sections/StartupSection.svelte:228-362` ("Startstellungen"): the Basisebene radio list (first entry
  // "(erste Basisebene)" = none chosen), the Overlay-Ebenen checkboxes (on at start), and one "Startstellungen
  // speichern" button ("Speichern…" while it works), and after the layers v3's "Sichtbare Workflows" (WP-397,
  // `StartTypesBlock`). v4: the layers are `on_at_start` of the map's layers, the Objektarten `on_at_start` and
  // `values_at_start` of the type (A-040); all saved into the draft, and the participant's own choice still wins once
  // they make one.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import SettingsSection from './SettingsSection.svelte';
  import StartTypesBlock from './StartTypesBlock.svelte';
  import type { SectionProps } from './sections';

  let { data, locale, api, reload }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  const bases = $derived(data.startup.layers.filter((l) => l.kind === 'base'));
  const overlays = $derived(data.startup.layers.filter((l) => l.kind === 'overlay'));

  // The base on at start: the first flagged base, or null ("the first base layer").
  let base = $state<string | null>(
    untrack(() => data.startup.layers.find((l) => l.kind === 'base' && l.on)?.key ?? null),
  );
  let on = $state<readonly string[]>(
    untrack(() => data.startup.layers.filter((l) => l.kind === 'overlay' && l.on).map((l) => l.key)),
  );
  let allTypes = $state(data.startup.types.every((ty) => ty.on));
  let choice = $state<Record<string, { on: boolean; values: readonly string[] | null }>>(
    Object.fromEntries(
      data.startup.types.map((ty) => [
        ty.key,
        {
          on: ty.on,
          values: ty.values.every((v) => v.on) ? null : ty.values.filter((v) => v.on).map((v) => v.value),
        },
      ]),
    ),
  );
  let saving = $state(false);

  function toggleOverlay(key: string, checked: boolean): void {
    on = checked ? (on.includes(key) ? on : [...on, key]) : on.filter((k) => k !== key);
  }

  async function save(): Promise<void> {
    saving = true;
    const r = await api.saveStartup({
      base,
      overlays: on,
      types: Object.fromEntries(
        data.startup.types.map((ty) => [
          ty.key,
          { on: allTypes || (choice[ty.key]?.on ?? true), values: choice[ty.key]?.values ?? null },
        ]),
      ),
    });
    saving = false;
    if (!r.ok) return void toast.error(r.message || t('settings_startup_error'));
    toast.success(t('settings_startup_saved'));
    notifyDraftChanged();
    await reload();
  }
</script>

<SettingsSection name={t('settings_startup_title')} description={t('settings_startup_description')}>
  <div class="flex flex-col gap-6">
    <section class="flex flex-col gap-2" data-testid="startup-base">
      <Label>{t('settings_startup_base_layer')}</Label>
      <div class="flex flex-col gap-1">
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="base_layer" checked={base === null} onchange={() => (base = null)} />
          <span class="text-muted-foreground">{t('settings_startup_first_base')}</span>
        </label>
        {#each bases as l (l.key)}
          <label class="flex items-center gap-2 text-sm">
            <input type="radio" name="base_layer" checked={base === l.key} onchange={() => (base = l.key)} />
            {l.label}
          </label>
        {/each}
      </div>
    </section>

    <section class="flex flex-col gap-2" data-testid="startup-overlays">
      <Label>{t('settings_startup_overlays')}</Label>
      {#if overlays.length === 0}
        <p class="text-sm text-muted-foreground">{t('settings_startup_no_overlays')}</p>
      {:else}
        <div class="flex flex-col gap-1">
          {#each overlays as l (l.key)}
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={on.includes(l.key)}
                onchange={(e) => toggleOverlay(l.key, e.currentTarget.checked)}
              />
              {l.label}
            </label>
          {/each}
        </div>
      {/if}
    </section>

    <StartTypesBlock types={data.startup.types} {locale} bind:all={allTypes} bind:choice />

    <div>
      <Button onclick={save} disabled={saving}>
        {saving ? t('settings_startup_saving') : t('settings_startup_save')}
      </Button>
    </div>
  </div>
</SettingsSection>
