<script lang="ts">
  // v3 `settings/sections/ApiTokensSection.svelte:109-253`: a create box (Bezeichnung, Läuft ab, "Token erstellen"), the
  // banner that shows the new token once with "Kopieren", the table (Bezeichnung + last four, Erstellt, Zuletzt verwendet,
  // Läuft ab, Widerrufen with a confirmation) and the "QGIS verbinden" box with three steps and the connection URL.
  // v4 (Q18, A-037): the token belongs to a participant and gives full access as that participant, so the "Zugriff"
  // column and the "Schreiben erlauben" box are replaced by the Teilnehmer field and column; the URL is the project's
  // OGC endpoint `/api/p/<project>/ogc`.
  import Copy from '@lucide/svelte/icons/copy';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import SettingsSection from './SettingsSection.svelte';
  import type { SectionProps } from './sections';
  import type { ApiTokenRow, ParticipantOption } from './types';

  let { locale, project, api }: SectionProps = $props();
  const t = (key: AdminKey): string => adminMessage(locale, key);

  const selectClass =
    'h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:ring-1 focus:ring-ring focus:outline-none';

  let tokens = $state<readonly ApiTokenRow[]>([]);
  let participants = $state<readonly ParticipantOption[]>([]);
  let newLabel = $state('');
  let newParticipant = $state('');
  let ownerKind = $state<'participant' | 'admin'>('participant');
  let newExpiry = $state('');
  let creating = $state(false);
  let createdToken = $state<string | null>(null);

  // The origin exists only in the browser: the page may be rendered on the server (a direct load of ?section=api-tokens).
  let origin = $state('');
  $effect(() => {
    origin = window.location.origin;
  });
  const base = $derived(`${origin}/api/p/${encodeURIComponent(project)}/ogc`);
  const nameOf = (token: ApiTokenRow): string => {
    if (token.participantId === null) return `${t('settings_tokens_admin_prefix')}${token.adminEmail ?? ''}`;
    const id = token.participantId;
    const p = participants.find((x) => x.id === id);
    return p?.name ? `${p.name} (${id})` : id;
  };

  async function load(): Promise<void> {
    const [list, people] = await Promise.all([api.listTokens(), api.listParticipants()]);
    if (list.ok) tokens = list.value;
    else toast.error(t('settings_tokens_load_error'));
    if (people.ok) participants = people.value;
  }
  $effect(() => {
    void load();
  });

  /** v3 `fmtDate`: a date, or "Nie" when there is none. */
  function fmtDate(value: string | null): string {
    if (!value) return t('settings_tokens_never');
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(locale);
  }

  async function create(): Promise<void> {
    creating = true;
    createdToken = null;
    const r = await api.createToken({
      ...(ownerKind === 'admin' ? { admin: true as const } : { participant: newParticipant }),
      label: newLabel,
      ...(newExpiry ? { expiresAt: new Date(`${newExpiry}T23:59:59Z`).toISOString() } : {}),
    });
    creating = false;
    if (!r.ok) return void toast.error(t('settings_tokens_create_error'));
    createdToken = r.value.token;
    newLabel = '';
    newExpiry = '';
    await load();
  }

  async function revoke(id: string): Promise<void> {
    if (!confirm(t('settings_tokens_revoke_confirm'))) return;
    const r = await api.revokeToken(id);
    if (!r.ok) return void toast.error(t('settings_tokens_revoke_error'));
    toast.success(t('settings_tokens_revoked'));
    await load();
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('settings_tokens_copied'));
    } catch {
      /* clipboard unavailable */
    }
  }
</script>

<SettingsSection name={t('settings_tokens_title')} description={t('settings_tokens_description')}>
  <div class="flex flex-col gap-6">
    <form
      class="space-y-3 rounded-md border p-4"
      onsubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1">
          <Label for="api-token-owner">{t('settings_tokens_owner')}</Label>
          <select id="api-token-owner" bind:value={ownerKind} class={selectClass}>
            <option value="participant">{t('settings_tokens_owner_participant')}</option>
            <option value="admin">{t('settings_tokens_owner_admin')}</option>
          </select>
        </div>
        {#if ownerKind === 'participant'}
          <div class="space-y-1">
            <Label for="api-token-participant">{t('settings_tokens_participant')}</Label>
            <select id="api-token-participant" bind:value={newParticipant} required class={selectClass}>
              <option value="" disabled>{t('settings_tokens_participant_placeholder')}</option>
              {#each participants as p (p.id)}
                <option value={p.id}>{p.name ? `${p.name} (${p.id})` : p.id}</option>
              {/each}
            </select>
          </div>
        {/if}
        <div class="space-y-1">
          <Label for="api-token-label">{t('settings_tokens_label')}</Label>
          <Input
            id="api-token-label"
            bind:value={newLabel}
            required
            placeholder={t('settings_tokens_placeholder')}
          />
        </div>
      </div>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="space-y-1">
          <Label for="api-token-expiry">{t('settings_tokens_expiry')}</Label>
          <Input id="api-token-expiry" type="date" bind:value={newExpiry} />
        </div>
        <Button
          type="submit"
          disabled={creating ||
            (ownerKind === 'participant' && newParticipant === '') ||
            newLabel.trim() === ''}
        >
          {creating ? t('settings_tokens_creating') : t('settings_tokens_create')}
        </Button>
      </div>

      {#if createdToken}
        <div
          class="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3"
          data-testid="created-token"
        >
          <div class="text-sm font-medium">{t('settings_tokens_created_title')}</div>
          <div class="flex items-center gap-2">
            <code class="flex-1 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">{createdToken}</code>
            <Button type="button" variant="outline" size="sm" onclick={() => copy(createdToken ?? '')}>
              <Copy class="mr-1 h-3.5 w-3.5" />{t('settings_tokens_copy')}
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">{t('settings_tokens_created_hint')}</p>
        </div>
      {/if}
    </form>

    {#if tokens.length === 0}
      <p class="text-sm text-muted-foreground">{t('settings_tokens_none')}</p>
    {:else}
      <div class="overflow-x-auto rounded-md border">
        <table class="w-full text-sm" data-testid="token-table">
          <thead class="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th class="px-3 py-2">{t('settings_tokens_col_label')}</th>
              <th class="px-3 py-2">{t('settings_tokens_col_participant')}</th>
              <th class="px-3 py-2">{t('settings_tokens_col_created')}</th>
              <th class="px-3 py-2">{t('settings_tokens_col_last_used')}</th>
              <th class="px-3 py-2">{t('settings_tokens_col_expires')}</th>
              <th class="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each tokens as token (token.id)}
              <tr class="border-t">
                <td class="px-3 py-2">
                  <span class="font-medium">{token.label || '—'}</span>
                  <span class="ml-1 text-xs text-muted-foreground">…{token.lastFour}</span>
                </td>
                <td class="px-3 py-2 text-muted-foreground">{nameOf(token)}</td>
                <td class="px-3 py-2 text-muted-foreground">{fmtDate(token.createdAt)}</td>
                <td class="px-3 py-2 text-muted-foreground">{fmtDate(token.lastUsedAt)}</td>
                <td class="px-3 py-2 text-muted-foreground">{fmtDate(token.expiresAt)}</td>
                <td class="px-3 py-2 text-right">
                  <Button variant="ghost" size="sm" onclick={() => revoke(token.id)}>
                    <Trash2 class="mr-1 h-3.5 w-3.5" />{t('settings_tokens_revoke')}
                  </Button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <div class="space-y-2 rounded-md border p-4">
      <div class="text-sm font-medium">{t('settings_tokens_usage_title')}</div>
      <ol class="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>{t('settings_tokens_usage_step1')}</li>
        <li>{t('settings_tokens_usage_step2')}</li>
        <li>{t('settings_tokens_usage_step3')}</li>
      </ol>
      <div class="pt-2 text-sm font-medium">{t('settings_tokens_urls_title')}</div>
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <code class="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1">{base}</code>
        <Button variant="outline" size="sm" aria-label={t('settings_tokens_copy')} onclick={() => copy(base)}>
          <Copy class="h-3.5 w-3.5" />
        </Button>
        <span class="basis-full text-muted-foreground">{t('settings_tokens_index_url_label')}</span>
      </div>
    </div>
  </div>
</SettingsSection>
