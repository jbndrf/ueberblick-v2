<script lang="ts">
  // v3 `TaskConfigSidebar.svelte:334-373`, the Bedingungen tab: "Nur verfügbar, wenn…" rows, "Wer darf
  // dies nutzen" (roles), "Beliebige Instanz | Nur eigene", the note on advanced conditions and the list
  // of available kinds. The roles are the task's `who` (C-004 step 3): roles inside the Bedingung, no separate "Wer"
  // section (owner, WP-615); a task with automatic actions and no `who` shows "Automatisch" (the system runs it).
  import { WHO_ADMIN } from '@ueberblick/core';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import RoleSelect from '../shared/RoleSelect.svelte';
  import { labelOf } from '../../shell/location';
  import type { BuilderContext } from '../shell/context';
  import { commitOps } from './commit';
  import ConditionRows from './ConditionRows.svelte';
  import { pathOptions } from './paths';
  import { createRoleOps, rolesOps } from './ops';
  import { isOnlyOwn, ownEditable, ownOps, rowsOps, withoutOwn } from './conditions-own';

  import { ROW_OP_MESSAGES, ROW_OPS } from './rows';

  interface Props {
    ctx: BuilderContext;
    task: string;
  }
  let { ctx, task }: Props = $props();

  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const file = $derived(doc.effective());
  const def = $derived(file.tasks?.[task]);
  const scope = $derived(`tasks.${task}`);
  const roles = $derived([
    ...Object.entries(file.roles ?? {}).map(([id, r]) => ({
      value: id,
      label: labelOf(r.label, ctx.locale, id),
    })),
    ...(file.roles?.[WHO_ADMIN] === undefined ? [{ value: WHO_ADMIN, label: t('tp_who_admin') }] : []),
  ]);
  const who = $derived(def?.who ?? []);
  const automatic = $derived(who.length === 0 && Object.keys(def?.auto ?? {}).length > 0);
  const paths = $derived(pathOptions(file, task, ctx.locale, t('tp_path_actor')));

  const own = $derived(isOnlyOwn(def?.when));
  let ownError: string | undefined = $state();
  const setOwn = (on: boolean): void =>
    void (ownError = commitOps(ctx, ownOps(doc, task, on), `${scope}.when`));

  let rolesError: string | undefined = $state();

  function setRoles(ids: string[]): void {
    rolesError = commitOps(ctx, rolesOps(doc, task, ids), scope);
  }

  function createRole(name: string): string | undefined {
    const made = createRoleOps(file, ctx.locale, name);
    for (const op of made.ops) if (ctx.apply(op).refused !== undefined) return undefined;
    return made.key;
  }
</script>

<div class="tab" data-testid="task-tab-conditions">
  <ConditionRows
    id={`task-${task}`}
    source={withoutOwn(def?.when)}
    {paths}
    {t}
    apply={(src) => commitOps(ctx, rowsOps(doc, task, src), `${scope}.when`)}
  />

  <RoleSelect
    testid={`task-${task}-roles`}
    label={t('tp_roles')}
    selectedIds={who}
    {roles}
    {t}
    help={automatic ? t('tp_who_automatic') : t('tp_who_help')}
    oncreate={createRole}
    onchange={setRoles}
  />
  {#if automatic}<p class="badge" data-testid={`task-${task}-automatic`}>{t('tp_automatic')}</p>{/if}
  <p class="hint">{t('tp_roles_create_hint')}</p>
  {#if rolesError !== undefined}<p class="error" role="alert" data-testid="task-roles-error">
      {rolesError}
    </p>{/if}

  <div class="ownership" role="group" aria-label={t('tp_ownership')}>
    <Button
      variant={own ? 'outline' : 'default'}
      size="sm"
      aria-pressed={!own}
      disabled={!ownEditable(def?.when)}
      onclick={() => setOwn(false)}>{t('tp_ownership_any')}</Button
    >
    <Button
      variant={own ? 'default' : 'outline'}
      size="sm"
      aria-pressed={own}
      disabled={!ownEditable(def?.when)}
      onclick={() => setOwn(true)}>{t('tp_ownership_self')}</Button
    >
  </div>
  {#if ownError !== undefined}<p class="error" role="alert" data-testid="task-ownership-error">
      {ownError}
    </p>{/if}

  <p class="hint">{t('tp_advanced_note')}</p>
  <details class="kinds">
    <summary>{t('tp_kinds')}</summary>
    <ul>
      {#each ROW_OPS as o (o)}
        <li><code>{o}</code>: {t(ROW_OP_MESSAGES[o])}</li>
      {/each}
    </ul>
  </details>
</div>

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .badge {
    align-self: flex-start;
    margin: 0;
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--foreground);
    background: var(--accent);
    border-radius: 999px;
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--destructive);
  }
  .ownership {
    display: flex;
    gap: 0.5rem;
  }
  .kinds {
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .kinds summary {
    cursor: pointer;
  }
  .kinds ul {
    margin: 0.25rem 0 0;
    padding-left: 1rem;
    list-style: disc;
  }
</style>
