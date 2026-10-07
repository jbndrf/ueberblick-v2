<script lang="ts">
  // v3 `InfoPagesSection.svelte:166-250`: the create/edit dialog. Titel, Inhalt (HTML, 8 rows, at most 40vh), the hint
  // about the allowed tags, the box listing v3's four per-participant variables, Sortierung (0 or more) and
  // Abbrechen / Erstellen or Speichern. The form is checked here (v3: the `required` attributes) and again by the server.
  import { untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { INFO_VARIABLES, infoPageProblem, type InfoPageRow, type InfoPageValues } from './info-pages';

  let {
    open = $bindable(false),
    locale,
    page,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    /** The page to edit, or null for a new one. */
    page: InfoPageRow | null;
    onsave: (values: InfoPageValues) => void | Promise<void>;
  } = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  let title = $state('');
  let content = $state('');
  let sort = $state<string | number>('0');
  let saving = $state(false);
  let invalid = $state<'title' | 'content' | 'sort' | null>(null);

  // Fresh each time it opens, from the page being edited.
  $effect(() => {
    if (open)
      untrack(() => {
        title = page?.title ?? '';
        content = page?.content ?? '';
        sort = String(page?.sortOrder ?? 0);
        invalid = null;
        saving = false;
      });
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const values: InfoPageValues = {
      ...(page === null ? {} : { key: page.key }),
      title,
      content,
      // a number input binds a number once it was typed into, and the string it started with before
      sortOrder: String(sort).trim() === '' ? 0 : Number(sort),
    };
    invalid = infoPageProblem(values);
    if (invalid !== null) return;
    saving = true;
    try {
      await onsave(values);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{page === null ? t('info_create') : t('info_edit')}</Dialog.Title>
    </Dialog.Header>

    <form class="flex min-h-0 flex-col gap-4 overflow-y-auto" onsubmit={submit} novalidate>
      <div class="space-y-2">
        <Label for="info_title">{t('info_field_title')}</Label>
        <Input
          id="info_title"
          name="title"
          required
          bind:value={title}
          aria-invalid={invalid === 'title'}
          placeholder={t('info_field_title_ph')}
        />
        {#if invalid === 'title'}<p class="text-xs text-destructive" role="alert">
            {t('info_err_title')}
          </p>{/if}
      </div>

      <div class="space-y-2">
        <Label for="info_content">{t('info_field_content')}</Label>
        <Textarea
          id="info_content"
          name="content"
          required
          rows={8}
          class="max-h-[40vh]"
          bind:value={content}
          aria-invalid={invalid === 'content'}
          placeholder={t('info_field_content_ph')}
        />
        {#if invalid === 'content'}<p class="text-xs text-destructive" role="alert">
            {t('info_err_content')}
          </p>{/if}
        <p class="text-xs text-muted-foreground">{t('info_content_hint')}</p>
        <div
          class="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground"
          data-testid="info-variables"
        >
          <p class="mb-1 font-medium text-foreground">{t('info_variables_title')}</p>
          <ul class="space-y-1">
            {#each INFO_VARIABLES as v (v.marker)}
              <li><code class="font-mono">{v.marker}</code> — {t(v.hint)}</li>
            {/each}
          </ul>
        </div>
      </div>

      <div class="space-y-2">
        <Label for="info_sort">{t('info_sort')}</Label>
        <Input
          id="info_sort"
          name="sort_order"
          type="number"
          min="0"
          bind:value={sort}
          aria-invalid={invalid === 'sort'}
        />
        {#if invalid === 'sort'}<p class="text-xs text-destructive" role="alert">{t('info_err_sort')}</p>{/if}
      </div>

      <Dialog.Footer>
        <Button variant="outline" type="button" onclick={() => (open = false)}>{t('info_cancel')}</Button>
        <Button type="submit" disabled={saving}
          >{page === null ? t('info_submit_create') : t('info_submit_save')}</Button
        >
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
