<script lang="ts">
  // v3 `admin/instance/+page.svelte:177-295`: one card per legal page with a link to its public address, the fields
  // Titel, Slug, Reihenfolge, "Im Consent-Footer anzeigen" and Inhalt, Löschen (after a confirm) and Speichern.
  import { untrack } from 'svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
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
  import { slugOf, sortOrderOf, type LegalPageView } from './model';

  let {
    page,
    locale,
    api,
    reload,
  }: { page: LegalPageView; locale: Locale; api: InstanceApi; reload: () => Promise<void> } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  // The form starts from the page as loaded; the list keys cards by slug, so a renamed page starts a new form.
  const start = untrack(() => page);
  let title = $state(start.title);
  let slug = $state(start.slug);
  let sort = $state(String(start.sortOrder));
  let footer = $state(start.showInConsentFooter);
  let body = $state(start.body);
  let confirming = $state(false);
  let busy = $state(false);
  const id = $derived(`legal-${page.slug}`);

  async function save(e: Event): Promise<void> {
    e.preventDefault();
    busy = true;
    const r = await api.updatePage(page.slug, {
      title,
      slug: slugOf(slug, title),
      body,
      sortOrder: sortOrderOf(sort),
      showInConsentFooter: footer,
    });
    busy = false;
    if (!r.ok) return void toast.error(r.refused ? r.message : t('inst_save_error'));
    toast.success(t('inst_save_success'));
    await reload();
  }

  async function remove(): Promise<void> {
    busy = true;
    const r = await api.deletePage(page.slug);
    busy = false;
    confirming = false;
    if (!r.ok) return void toast.error(t('inst_delete_error'));
    toast.success(t('inst_delete_success'));
    await reload();
  }
</script>

<Card.Root data-testid="legal-page" data-slug={page.slug}>
  <Card.Header>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <Card.Title class="break-words">{page.title}</Card.Title>
      <a
        href="/legal/{page.slug}"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        /legal/{page.slug}
        <ExternalLink class="h-3 w-3" />
      </a>
    </div>
  </Card.Header>
  <Card.Content>
    <form class="space-y-4" onsubmit={save}>
      <div class="grid gap-4 sm:grid-cols-[2fr_1fr_auto]">
        <div class="space-y-2">
          <Label for="title-{id}">{t('inst_field_title')}</Label>
          <Input id="title-{id}" required bind:value={title} />
        </div>
        <div class="space-y-2">
          <Label for="slug-{id}">{t('inst_field_slug')}</Label>
          <Input id="slug-{id}" required bind:value={slug} />
        </div>
        <div class="space-y-2">
          <Label for="sort-{id}">{t('inst_field_sort')}</Label>
          <Input id="sort-{id}" type="number" min="0" bind:value={sort} />
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Checkbox id="footer-{id}" bind:checked={footer} />
        <Label for="footer-{id}">{t('inst_field_footer')}</Label>
      </div>

      <div class="space-y-2">
        <Label for="content-{id}">{t('inst_field_content')}</Label>
        <Textarea id="content-{id}" rows={14} bind:value={body} class="font-mono text-xs" />
      </div>

      <div class="flex justify-between">
        <Button
          type="button"
          variant="ghost"
          class="text-destructive"
          disabled={busy}
          onclick={() => (confirming = true)}
        >
          <Trash2 class="mr-1 h-4 w-4" />
          {t('inst_delete')}
        </Button>
        <Button type="submit" disabled={busy}>{t('inst_save')}</Button>
      </div>
    </form>
  </Card.Content>
</Card.Root>

<!-- v3 asked with the browser's confirm(); the kit's dialog says the same and fits a phone. -->
<AlertDialog.Root bind:open={confirming}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{t('inst_delete')}</AlertDialog.Title>
      <AlertDialog.Description>{t('inst_delete_confirm')}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{t('inst_cancel')}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => void remove()}
        class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
      >
        {t('inst_delete')}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
