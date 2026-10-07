<script lang="ts">
  // v3 `admin/instance/+page.svelte:299-370`: the card "Rechtsseite hinzufügen" (Titel, Slug that follows the title when
  // empty, "Im Consent-Footer anzeigen" on by default, Inhalt), cleared after a successful create.
  import Plus from '@lucide/svelte/icons/plus';
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
  import { slugOf } from './model';

  let { locale, api, reload }: { locale: Locale; api: InstanceApi; reload: () => Promise<void> } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  let title = $state('');
  let slug = $state('');
  let body = $state('');
  let footer = $state(true);
  let busy = $state(false);

  async function create(e: Event): Promise<void> {
    e.preventDefault();
    busy = true;
    const r = await api.createPage({
      title,
      slug: slugOf(slug, title),
      body,
      sortOrder: 0,
      showInConsentFooter: footer,
    });
    busy = false;
    if (!r.ok) return void toast.error(r.refused ? r.message : t('inst_create_error'));
    toast.success(t('inst_create_success'));
    title = '';
    slug = '';
    body = '';
    footer = true;
    await reload();
  }
</script>

<Card.Root data-testid="new-page-card">
  <Card.Header>
    <Card.Title>
      <Plus class="inline h-5 w-5" />
      {t('inst_add_page')}
    </Card.Title>
  </Card.Header>
  <Card.Content>
    <form class="space-y-4" onsubmit={create}>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-2">
          <Label for="new-title">{t('inst_field_title')}</Label>
          <Input id="new-title" required bind:value={title} />
        </div>
        <div class="space-y-2">
          <Label for="new-slug">{t('inst_field_slug')}</Label>
          <Input id="new-slug" placeholder={t('inst_field_slug_hint')} bind:value={slug} />
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Checkbox id="new-footer" bind:checked={footer} />
        <Label for="new-footer">{t('inst_field_footer')}</Label>
      </div>

      <div class="space-y-2">
        <Label for="new-content">{t('inst_field_content')}</Label>
        <Textarea id="new-content" rows={10} bind:value={body} class="font-mono text-xs" />
      </div>

      <div class="flex justify-end">
        <Button type="submit" disabled={busy} data-testid="new-page-create">{t('inst_create')}</Button>
      </div>
    </form>
  </Card.Content>
</Card.Root>
