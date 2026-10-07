<script lang="ts">
  import { untrack } from 'svelte';
  // v3 `settings/sections/BrandingSection.svelte:62-182`: the icon preview (or a dashed placeholder), the App-Name
  // field with its own Speichern, the icon file input with "Symbol hochladen" (enabled once a file is chosen), the
  // hint, and "Symbol entfernen" while an icon exists. v4: the three writes go to the project's draft (Q13) and the
  // icon's bytes to the blob store; the publish bar then shows the unpublished change.
  import ImageIcon from '@lucide/svelte/icons/image';
  import Upload from '@lucide/svelte/icons/upload';
  import X from '@lucide/svelte/icons/x';
  import { BRANDING_ICON_TYPES } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';

  let { data, locale, project, api, reload }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  let displayName = $state(untrack(() => data.branding.name));
  let savingName = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);
  let preview = $state<string | null>(null);
  let chosen = $state<File | null>(null);
  let uploading = $state(false);
  let removing = $state(false);

  const iconUrl = $derived(
    data.branding.icon === null ? null : `/api/p/${encodeURIComponent(project)}/blobs/${data.branding.icon}`,
  );

  /** A write reached the draft: the shell's publish bar follows, then the page data reloads. */
  async function changed(): Promise<void> {
    notifyDraftChanged();
    await reload();
  }

  async function saveName(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    savingName = true;
    const r = await api.saveBranding({ name: displayName });
    savingName = false;
    if (!r.ok) return void toast.error(r.message || t('settings_name_error'));
    toast.success(t('settings_name_saved'));
    await changed();
  }

  /** v3 `handleIconPreview`: show the chosen file before it is uploaded. */
  function choose(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    chosen = file;
    if (file === null) return void (preview = null);
    const reader = new FileReader();
    reader.onload = () => (preview = typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  }

  function clearChoice(): void {
    preview = null;
    chosen = null;
    if (fileInput) fileInput.value = '';
  }

  async function upload(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (chosen === null) return;
    uploading = true;
    const sent = await api.uploadIcon(chosen);
    const saved = sent.ok ? await api.saveBranding({ icon: sent.value.sha256 }) : null;
    uploading = false;
    if (!sent.ok) return void toast.error(sent.message);
    if (saved === null || !saved.ok)
      return void toast.error(saved?.message ?? t('settings_icon_upload_error'));
    toast.success(t('settings_icon_uploaded'));
    clearChoice();
    await changed();
  }

  async function remove(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    removing = true;
    const r = await api.saveBranding({ icon: null });
    removing = false;
    if (!r.ok) return void toast.error(r.message || t('settings_icon_remove_error'));
    toast.success(t('settings_icon_removed'));
    clearChoice();
    await changed();
  }
</script>

<SettingsSection name={t('settings_branding_title')} description={t('settings_branding_description')}>
  <div class="flex flex-col items-start gap-4 sm:flex-row sm:gap-6">
    <div class="shrink-0" data-testid="icon-preview">
      {#if preview}
        <img
          src={preview}
          alt={t('settings_icon_preview_alt')}
          class="h-20 w-20 rounded-lg border object-cover"
        />
      {:else if iconUrl}
        <img src={iconUrl} alt={t('settings_icon_alt')} class="h-20 w-20 rounded-lg border object-cover" />
      {:else}
        <div
          class="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed bg-muted/50"
          data-testid="icon-placeholder"
        >
          <ImageIcon class="h-8 w-8 text-muted-foreground" />
        </div>
      {/if}
    </div>

    <div class="w-full min-w-0 flex-1 space-y-4">
      <form onsubmit={saveName}>
        <div class="space-y-2">
          <Label for="display_name">{t('settings_display_name')}</Label>
          <div class="flex flex-wrap items-center gap-3">
            <Input
              id="display_name"
              name="display_name"
              bind:value={displayName}
              placeholder={data.projectName}
              class="max-w-xs"
            />
            <Button type="submit" size="sm" disabled={savingName}>{t('settings_save')}</Button>
          </div>
          <p class="text-xs text-muted-foreground">{t('settings_display_name_hint')}</p>
        </div>
      </form>

      <form onsubmit={upload}>
        <div class="space-y-2">
          <Label for="icon_file">{t('settings_upload_icon')}</Label>
          <div class="flex flex-wrap items-center gap-3">
            <Input
              id="icon_file"
              type="file"
              name="icon"
              accept={BRANDING_ICON_TYPES.keys.join(',')}
              aria-label={t('settings_icon_file')}
              bind:ref={fileInput}
              onchange={choose}
              class="max-w-xs"
            />
            <Button type="submit" size="sm" disabled={uploading || chosen === null}>
              <Upload class="mr-2 h-4 w-4" />
              {t('settings_upload_icon')}
            </Button>
          </div>
        </div>
      </form>
      <p class="text-xs text-muted-foreground">{t('settings_icon_hint')}</p>

      {#if data.branding.icon}
        <form onsubmit={remove}>
          <Button type="submit" variant="ghost" size="sm" class="text-destructive" disabled={removing}>
            <X class="mr-2 h-4 w-4" />
            {t('settings_remove_icon')}
          </Button>
        </form>
      {/if}
    </div>
  </div>
</SettingsSection>
