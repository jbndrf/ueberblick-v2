<script lang="ts">
  // v3 `ModelOverviewView.svelte:90-120` (Aufgaben): the tabular index of the Objektart's tasks. A row opens the task
  // in the right pane, the same editor the canvas uses (WP-336). v3 columns: name, stage, mode, tools, target; here
  // the name, "Angeboten in Phase", "Wer darf dies nutzen" (WP-378, the roles), the start (manual or by a rule), the
  // number of form fields and the Phase the task leads to. v3 had no header row; a screen reader needs one (done better).
  import { getBuilderContext } from '../../shell/context';
  import { TASK_PHASES, TASK_STARTS, buildTaskRows, type TaskRowModel } from './model';

  const ctx = getBuilderContext();
  const t = ctx.t;

  const rows = $derived(buildTaskRows(ctx.doc(), ctx.type, ctx.locale));
  const selected = $derived(ctx.selection().kind === 'task' ? ctx.selection().id : undefined);

  function phaseText(r: TaskRowModel): string {
    if (r.phase === TASK_PHASES.entry) return t('tt_phase_entry');
    if (r.phase === TASK_PHASES.pinned) return r.phases.join(', ');
    return r.phase === TASK_PHASES.any ? t('tt_phase_any') : '—';
  }
  const rolesText = (r: TaskRowModel): string =>
    r.roles.length === 0 ? t('tt_roles_none') : r.roles.join(', ');
  const open = (key: string): void => ctx.select({ kind: 'task', id: key });
</script>

<div class="tasks" data-testid="tasks-table">
  {#if rows.length === 0}
    <p class="empty">{t('tt_empty')}</p>
  {:else}
    <div class="scroll">
      <table aria-label={t('tt_table')}>
        <thead>
          <tr>
            <th class="name" scope="col">{t('tt_col_name')}</th>
            <th scope="col">{t('tp_stage')}</th>
            <th scope="col">{t('tp_roles')}</th>
            <th scope="col">{t('tt_col_start')}</th>
            <th class="num" scope="col">{t('tt_col_fields')}</th>
            <th scope="col">{t('tt_col_target')}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.key)}
            <tr class:selected={selected === r.key} data-task={r.key} onclick={() => open(r.key)}>
              <th class="name" scope="row">
                <button
                  type="button"
                  class="open"
                  aria-label={t('tt_open', { name: r.label })}
                  aria-current={selected === r.key ? 'true' : undefined}
                  onclick={(e) => {
                    e.stopPropagation();
                    open(r.key);
                  }}
                >
                  {r.label}
                </button>
              </th>
              <td>{phaseText(r)}</td>
              <td>{rolesText(r)}</td>
              <td>{r.start === TASK_STARTS.rule ? t('tt_start_rule') : t('tt_start_manual')}</td>
              <td class="num">{r.fields}</td>
              <td>{r.targets.length === 0 ? '—' : r.targets.map((x) => `→ ${x}`).join(', ')}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .tasks {
    min-width: 0;
  }
  .empty {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.8125rem;
  }
  th,
  td {
    padding: 0.375rem 0.5rem;
    border-bottom: 1px solid var(--border);
    text-align: left;
    font-weight: 400;
    color: var(--muted-foreground);
  }
  thead th {
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover,
  tbody tr.selected {
    background: var(--accent);
  }
  .num {
    text-align: right;
  }
  /* The first column stays while the table scrolls sideways on a phone, as the permission matrix's does. */
  .name {
    position: sticky;
    left: 0;
    z-index: 1;
    min-width: 9rem;
    background: var(--card);
    color: var(--foreground);
    font-weight: 500;
  }
  tbody tr:hover .name,
  tbody tr.selected .name {
    background: var(--accent);
  }
  .open {
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .open:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  td:not(.num) {
    min-width: 7rem;
  }
</style>
