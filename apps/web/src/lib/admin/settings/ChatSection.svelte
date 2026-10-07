<script lang="ts">
  // v3 `settings/sections/ChatSection.svelte:50-95`: a bordered row with the title, the hint and a switch ("Projekt-Chat
  // aktivieren"); while it is on, the role select "Im Chat zugelassene Rollen" (v3's MobileMultiSelect, empty = everyone,
  // with its hint) and one Speichern ("Speichern…" while it works). v4: the switch and the roles are the chat tool's
  // keys in the draft (`tools.chat`, `roles.<r>.app.tools.chat`); the page data says who has the chat, read through
  // `toolAvailabilityFor`, so a restricted selection and "alle" look as they did in v3.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { MultiSelect, type MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';

  let { data, locale, api, reload }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  let enabled = $state(data.chat.enabled);
  let selected = $state<string[]>([...data.chat.roles]);
  let saving = $state(false);
  const options = $derived<MultiSelectOption[]>(
    data.chat.options.map((o) => ({
      value: o.key,
      label: o.label,
      ...(o.description === undefined ? {} : { description: o.description }),
    })),
  );

  async function save(): Promise<void> {
    saving = true;
    const r = await api.saveChat({ enabled, roles: selected });
    saving = false;
    if (!r.ok) return void toast.error(r.message || t('settings_chat_save_error'));
    selected = [...r.value.chat.roles]; // "alle" comes back as the empty selection
    toast.success(t('settings_chat_saved'));
    notifyDraftChanged();
    await reload();
  }
</script>

<SettingsSection name={t('settings_chat_title')} description={t('settings_chat_description')}>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4 rounded-md border p-4">
      <div class="flex flex-col">
        <span id="chat-enable-label" class="font-medium">{t('settings_chat_enable_label')}</span>
        <span class="text-xs text-muted-foreground">{t('settings_chat_enable_hint')}</span>
      </div>
      <Switch bind:checked={enabled} aria-labelledby="chat-enable-label" />
    </div>

    {#if enabled}
      <div class="space-y-2">
        <Label for="chat-roles">{t('settings_chat_roles_label')}</Label>
        <MultiSelect
          id="chat-roles"
          bind:selected
          {options}
          labels={{ placeholder: t('settings_chat_roles_placeholder') }}
        />
        <p class="text-xs text-muted-foreground">{t('settings_chat_roles_hint')}</p>
      </div>
    {/if}

    <div>
      <Button type="button" onclick={save} disabled={saving}>
        {saving ? t('settings_saving') : t('settings_save')}
      </Button>
    </div>
  </div>
</SettingsSection>
