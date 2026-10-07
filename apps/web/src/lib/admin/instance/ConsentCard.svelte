<script lang="ts">
  // v3 `admin/instance/+page.svelte:61-162`: the card "Cookie-Consent-Banner" with the switch, heading, body and the
  // two button labels. The save is `PUT /api/instance/settings`.
  import { untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Card from '@ueberblick/ui/components/ui/card';
  import { Checkbox } from '@ueberblick/ui/components/ui/checkbox';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { InstanceApi } from './api';
  import { withLabelFallbacks, type InstanceSettingsView } from './model';

  let {
    settings,
    locale,
    api,
    reload,
  }: {
    settings: InstanceSettingsView;
    locale: Locale;
    api: InstanceApi;
    reload: () => Promise<void>;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  const start = untrack(() => settings);
  let requireConsent = $state(start.requireConsent);
  let title = $state(start.consentTitle);
  let body = $state(start.consentBody);
  let accept = $state(start.acceptLabel);
  let reject = $state(start.rejectLabel);
  let busy = $state(false);

  async function save(e: Event): Promise<void> {
    e.preventDefault();
    busy = true;
    const r = await api.saveSettings(
      withLabelFallbacks({
        requireConsent,
        consentTitle: title,
        consentBody: body,
        acceptLabel: accept,
        rejectLabel: reject,
      }),
    );
    busy = false;
    if (!r.ok) return void toast.error(t('inst_save_error'));
    toast.success(t('inst_save_success'));
    await reload();
  }
</script>

<Card.Root data-testid="consent-card">
  <Card.Header>
    <Card.Title>{t('inst_consent_title')}</Card.Title>
    <Card.Description>{t('inst_consent_desc')}</Card.Description>
  </Card.Header>
  <Card.Content>
    <form class="space-y-4" onsubmit={save}>
      <div class="flex items-start gap-2">
        <Checkbox id="require_consent_before_login" bind:checked={requireConsent} class="mt-0.5" />
        <div class="space-y-1">
          <Label for="require_consent_before_login">{t('inst_require_consent')}</Label>
          <p class="text-xs text-muted-foreground">{t('inst_require_consent_hint')}</p>
        </div>
      </div>

      <div class="space-y-2">
        <Label for="consent_banner_title">{t('inst_banner_title')}</Label>
        <Input
          id="consent_banner_title"
          bind:value={title}
          placeholder={t('inst_banner_title_placeholder')}
        />
      </div>

      <div class="space-y-2">
        <Label for="consent_banner_body">{t('inst_banner_body')}</Label>
        <Textarea id="consent_banner_body" rows={6} bind:value={body} class="font-mono text-xs" />
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-2">
          <Label for="consent_accept_label">{t('inst_accept_label')}</Label>
          <Input id="consent_accept_label" bind:value={accept} />
        </div>
        <div class="space-y-2">
          <Label for="consent_reject_label">{t('inst_reject_label')}</Label>
          <Input id="consent_reject_label" bind:value={reject} />
        </div>
      </div>

      <div class="flex justify-end">
        <Button type="submit" disabled={busy} data-testid="consent-save">{t('inst_save')}</Button>
      </div>
    </form>
  </Card.Content>
</Card.Root>
