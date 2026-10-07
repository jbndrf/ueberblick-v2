<script lang="ts">
  // v3's "Beim Start aktiv" row of ClusterSection (:75-102) and FieldFiltersSection (:259-290): a bordered row with the
  // label, a hint and one Switch that saves at once (reverted when the save fails). v3 had one project-wide switch; in
  // v4 a role has the tool (`roles.<r>.app.tools`), so that switch writes every role and a list below it sets one role.
  // v3's "Bald" badge (a tool that did not exist yet) is the "Nicht angeboten" badge of a role that does not have it.
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { SettingsApi } from './api';
  import type { ToolStartView } from './start-types';

  let {
    view,
    tool,
    hint,
    locale,
    api,
    reload,
  }: {
    view: ToolStartView;
    tool: 'cluster' | 'field_filters';
    /** The message key of the hint under "Beim Start aktiv". */
    hint: AdminKey;
    locale: Locale;
    api: SettingsApi;
    reload: () => Promise<void>;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  /** The roles' switches as shown: the saved state until a click changes one (reverted when its save fails). */
  let shown = $state<Record<string, boolean>>({});
  let saving = $state(false);
  const isOn = (key: string, saved: boolean): boolean => shown[key] ?? saved;
  /** `on` is the switch; `shownState` is what the caption says (switching on grants a role that lacked the tool). */
  const roles = $derived(
    view.roles.map((r) => {
      const on = isOn(r.key, r.state === 'active');
      return { ...r, on, shownState: on ? 'active' : r.state === 'none' ? 'none' : 'offered' };
    }),
  );
  const all = $derived(roles.length > 0 && roles.every((r) => r.on));

  // A reload brings the saved state: forget what was shown meanwhile.
  $effect(() => {
    void view;
    shown = {};
  });

  async function set(keys: readonly string[] | null, next: boolean): Promise<void> {
    const targets = keys ?? view.roles.map((r) => r.key);
    const before = { ...shown };
    for (const k of targets) shown[k] = next;
    saving = true;
    const r = await api.saveToolStart(tool, keys, next);
    saving = false;
    if (!r.ok) {
      shown = before;
      return void toast.error(r.message || t('settings_startup_error'));
    }
    toast.success(t('settings_start_saved'));
    notifyDraftChanged();
    await reload();
  }

  const stateLabel = (state: string): AdminKey =>
    state === 'active'
      ? 'settings_start_state_active'
      : state === 'offered'
        ? 'settings_start_state_offered'
        : 'settings_start_state_none';
</script>

<div class="flex flex-col gap-3" data-testid="tool-start-{tool}">
  <div class="flex items-center justify-between gap-4 rounded-md border p-4">
    <div class="flex flex-col">
      <span class="font-medium">{t('settings_start_enabled')}</span>
      <span class="text-xs text-muted-foreground">{t(hint)}</span>
    </div>
    <Switch
      checked={all}
      disabled={saving || roles.length === 0}
      aria-label={t('settings_start_all_roles')}
      onCheckedChange={(next) => void set(null, next)}
    />
  </div>

  {#if roles.length > 0}
    <div class="flex flex-col gap-1">
      <span class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('settings_start_roles')}
      </span>
      <ul class="flex flex-col divide-y rounded-md border">
        {#each roles as r (r.key)}
          <li class="flex items-center justify-between gap-3 px-3 py-2" data-role={r.key}>
            <div class="flex min-w-0 flex-col">
              <span class="truncate text-sm font-medium">{r.label}</span>
              <span class="text-xs text-muted-foreground">
                {#if r.shownState === 'none'}
                  <span class="rounded-full border px-2 py-0.5" title={t('settings_start_none_title')}>
                    {t('settings_start_state_none')}
                  </span>
                {:else}
                  {t(stateLabel(r.shownState))}
                {/if}
              </span>
            </div>
            <Switch
              checked={r.on}
              disabled={saving}
              aria-label={r.label}
              onCheckedChange={(next) => void set([r.key], next)}
            />
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
