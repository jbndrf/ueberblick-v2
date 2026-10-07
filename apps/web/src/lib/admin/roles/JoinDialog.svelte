<script lang="ts">
  // v3's "Selbstbeitritts-Link" dialog (`roles/+page.svelte:487-609`), opened by "Beitritts-URL & Voreinstellungen
  // anzeigen" in the row menu: the Beitritts-URL (read-only field, selects on click, Kopieren with a toast), the quota
  // "Max. Arbeitsabläufe pro Teilnehmer:in (0 = unbegrenzt)" with its own Speichern, and the list of defaults a guest gets.
  // The quota is config (`roles.<r>.quota`), so Speichern writes the draft and says so; the URL and defaults are not.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';

  export interface JoinRole {
    readonly label: string;
    readonly slug: string;
    readonly quota: number;
    /** The role's home view name, or '' when none is set (then a guest lands on the map, as in v3). */
    readonly home: string;
  }

  let {
    open = $bindable(false),
    locale,
    role,
    origin,
    onsavequota,
  }: {
    open?: boolean;
    locale: Locale;
    role: JoinRole | null;
    /** The site's origin, in front of `/join/<slug>`. */
    origin: string;
    /** Saves the quota in the draft; true when it worked (the page shows the refusal itself). */
    onsavequota: (quota: number) => Promise<boolean>;
  } = $props();

  const t = (key: AdminKey): string => adminMessage(locale, key);
  const uid = $props.id();
  let quotaInput = $state<number | null>(0);
  let saving = $state(false);
  const url = $derived(role ? `${origin}/join/${role.slug}` : '');

  // The quota field starts from the role's current value each time the dialog opens.
  $effect(() => {
    if (open && role) quotaInput = role.quota;
  });

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('rol_join_url_copied'));
    } catch {
      toast.error(t('rol_join_url_copy_error'));
    }
  }

  async function save(): Promise<void> {
    const value = quotaInput;
    if (value === null || !Number.isInteger(value) || value < 0) {
      toast.error(t('rol_quota_invalid'));
      return;
    }
    saving = true;
    try {
      await onsavequota(value);
    } finally {
      saving = false;
    }
  }

  const defaults = $derived<readonly (readonly [AdminKey, string, boolean])[]>([
    ['rol_join_default_name', t('rol_join_default_name_value'), true],
    ['rol_join_default_role', role?.label ?? '', false],
    ['rol_join_default_email', t('rol_join_default_email_value'), false],
    ['rol_join_default_active', t('rol_join_default_active_value'), false],
    ['rol_join_default_landing', role?.home ? role.home : '/map', !role?.home],
    ['rol_join_default_retention', t('rol_join_default_retention_value'), false],
  ]);
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90svh] max-w-lg overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>
        {t('rol_join_title')}
        {#if role}<span class="font-normal text-muted-foreground">— {role.label}</span>{/if}
      </Dialog.Title>
      <Dialog.Description>{t('rol_join_desc')}</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-5 py-2">
      <div class="space-y-2">
        <Label for="{uid}-url">{t('rol_join_url_label')}</Label>
        <div class="flex items-center gap-2">
          <input
            id="{uid}-url"
            type="text"
            readonly
            value={url}
            onclick={(e) => e.currentTarget.select()}
            onfocus={(e) => e.currentTarget.select()}
            class="h-9 min-w-0 flex-1 rounded-md border border-input bg-muted/40 px-3 py-1 font-mono text-xs shadow-sm select-all focus:ring-1 focus:ring-ring focus:outline-none"
          />
          <Button type="button" variant="outline" size="sm" onclick={() => void copy()}>
            {t('rol_join_copy')}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">{t('rol_join_url_hint')}</p>
      </div>

      <div class="space-y-2">
        <Label for="{uid}-quota">{t('rol_quota_label')}</Label>
        <div class="flex items-center gap-2">
          <Input id="{uid}-quota" type="number" min="0" step="1" bind:value={quotaInput} class="flex-1" />
          <Button type="button" size="sm" disabled={saving} onclick={() => void save()}>
            {t('rol_quota_save')}
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">{t('rol_quota_help')}</p>
        <p class="text-xs text-muted-foreground">{t('rol_quota_draft_hint')}</p>
      </div>

      <div class="space-y-2">
        <h4 class="text-sm font-medium">{t('rol_join_defaults_title')}</h4>
        <ul class="space-y-1.5 rounded-md border bg-muted/20 p-3 text-sm">
          {#each defaults as [label, value, mono] (label)}
            <li class="flex justify-between gap-4">
              <span class="text-muted-foreground">{t(label)}</span>
              <span class={mono ? 'font-mono' : ''}>{value}</span>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{t('rol_join_close')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
