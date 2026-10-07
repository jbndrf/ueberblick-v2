<script lang="ts">
  // The no-roles state links to the roles page (v3 :130-136), two levels up from the builder's route.
  // v3 `PermissionsMatrixView.svelte`: the overview for bulk permission changes of one Objektart. Roles are the
  // columns; rows are who may see the objects, (Erweitert) create and delete them, and per property who reads and
  // who edits it. The same data the in-context pickers of the field pane (WP-337) edit: both write the same draft keys.
  import type { PermAction } from '@ueberblick/core';
  import type { MessageKey } from '../../../shell/messages';
  import { getBuilderContext } from '../../shell/context';
  import MatrixCell from './MatrixCell.svelte';
  import MatrixToolbar from './MatrixToolbar.svelte';
  import { buildPermissionModel, type Density, type MatrixRowModel } from './model';
  import { privateOp, privateState, resetOp, toggleOp } from './ops';

  const ctx = getBuilderContext();
  const t = ctx.t;

  let density = $state<Density>('basic');

  const file = $derived(ctx.doc().effective());
  const model = $derived(buildPermissionModel(ctx.doc(), ctx.type, ctx.locale, t));
  const allRoles = $derived(model.roles.map((r) => r.key));
  const columns = $derived(model.roles.length);
  const privacy = $derived(privateState(file, ctx.type));
  const when = $derived(file.types?.[ctx.type]?.permissions?.visible_when);

  // v3 hid the advanced rows, and then every band and section that had none left.
  const sections = $derived(
    model.sections
      .map((s) => ({
        ...s,
        bands: s.bands
          .filter((b) => density === 'advanced' || !b.advanced)
          .map((b) => ({ ...b, rows: b.rows.filter((r) => density === 'advanced' || !r.advanced) }))
          .filter((b) => b.rows.length > 0),
      }))
      .filter((s) => s.bands.length > 0),
  );

  const ACTIONS: Record<PermAction, MessageKey> = {
    see: 'matrix_action_see',
    create: 'matrix_action_create',
    write: 'matrix_action_write',
    delete: 'matrix_action_delete',
  };
  const actionLabel = (row: MatrixRowModel): string =>
    t(row.action === 'see' && row.property !== undefined ? 'matrix_action_read' : ACTIONS[row.action]);
  const cellLabel = (row: MatrixRowModel, role: string): string =>
    t('matrix_cell', { role: roleLabel(role), row: row.subject, action: actionLabel(row) });
  const roleLabel = (key: string): string => model.roles.find((r) => r.key === key)?.label ?? key;
  const lockedReason = (row: MatrixRowModel): string | undefined =>
    row.locked === undefined
      ? undefined
      : t(row.locked === 'row' ? 'matrix_locked_row' : 'matrix_locked_all_rows');

  function toggle(row: MatrixRowModel, role: string): void {
    const op = toggleOp(ctx.doc(), ctx.type, row, role, allRoles);
    if (op !== undefined) ctx.apply(op);
  }
  function reset(row: MatrixRowModel, role: string): void {
    const op = resetOp(ctx.doc(), ctx.type, row, role, allRoles);
    if (op !== undefined) ctx.apply(op);
  }
  function setPrivate(on: boolean): void {
    const op = privateOp(ctx.doc(), ctx.type, on);
    if (op !== undefined) ctx.apply(op);
  }
</script>

<section class="matrix" aria-label={t('matrix_title')} data-testid="permission-matrix">
  <MatrixToolbar
    {t}
    {density}
    ondensity={(d) => (density = d)}
    privateState={privacy}
    customWhen={when}
    onprivate={setPrivate}
  />

  {#if !model.available}
    <p class="empty" role="status" data-testid="matrix-unavailable">{t('matrix_unavailable')}</p>
  {:else if columns === 0}
    <div class="empty">
      <p>{t('matrix_no_roles')}</p>
      <a class="manage-roles" href="../../roles">{t('matrix_manage_roles')}</a>
    </div>
  {:else}
    <div class="scroll">
      <table aria-label={t('matrix_table')}>
        <thead>
          <tr>
            <th class="corner" scope="col"></th>
            {#each model.roles as role (role.key)}
              <th class="role" scope="col" data-role={role.key}><span>{role.label}</span></th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each sections as section (section.id)}
            <tr>
              <td class="section" colspan={columns + 1}>{section.label}</td>
            </tr>
            {#each section.bands as band (band.id)}
              <tr class="band">
                <th class="name" scope="rowgroup">{band.label}</th>
                <td colspan={columns}></td>
              </tr>
              {#each band.rows as row (row.id)}
                <tr data-row={row.id}>
                  <th class="name" class:nested={row.indent === 1} scope="row">
                    {row.label}
                    {#if row.locked === 'all_rows_visible'}
                      <small class="note">{t('matrix_locked_all_rows')}</small>
                    {/if}
                  </th>
                  {#each row.cells as cell (cell.role)}
                    <td>
                      <MatrixCell
                        allowed={cell.allowed}
                        isAll={row.audience?.kind === 'all'}
                        action={row.action}
                        label={cellLabel(row, cell.role)}
                        lockedReason={lockedReason(row)}
                        modified={cell.modified}
                        resetLabel={t('matrix_reset', { role: roleLabel(cell.role), row: row.subject })}
                        ontoggle={() => toggle(row, cell.role)}
                        onreset={() => reset(row, cell.role)}
                      />
                    </td>
                  {/each}
                </tr>
              {/each}
            {/each}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .matrix {
    --matrix-allowed: #16a34a;
    display: flex;
    height: 100%;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    background: var(--card);
  }
  :global(.dark) .matrix {
    --matrix-allowed: #4ade80;
  }
  .scroll {
    min-height: 0;
    flex: 1;
    overflow: auto;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.875rem;
  }
  th,
  td {
    border-bottom: 1px solid var(--border);
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--card);
  }
  .corner {
    left: 0;
    z-index: 30;
    min-width: 10rem;
    border-right: 1px solid var(--border);
  }
  .role {
    min-width: 5rem;
    max-width: 9rem;
    padding: 0.5rem;
    text-align: center;
    vertical-align: bottom;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .role span {
    overflow-wrap: anywhere;
  }
  td {
    padding: 0.25rem;
    text-align: center;
  }
  .section {
    background: var(--muted);
    padding: 0.375rem 0.75rem;
    text-align: left;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .band td {
    background: color-mix(in oklab, var(--muted) 40%, transparent);
  }
  .name {
    position: sticky;
    left: 0;
    z-index: 10;
    min-width: 10rem;
    padding: 0.25rem 0.75rem;
    border-right: 1px solid var(--border);
    background: var(--card);
    text-align: left;
    font-weight: 400;
  }
  .band .name {
    background: var(--muted);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .name.nested {
    padding-left: 2.25rem;
  }
  .note {
    display: block;
    font-size: 0.6875rem;
    font-weight: 400;
    color: var(--muted-foreground);
  }
  .empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 2rem;
    text-align: center;
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }
  .empty p {
    margin: 0;
  }
  .empty a {
    font-weight: 500;
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  @media (min-width: 768px) {
    .corner,
    .name {
      min-width: 14rem;
    }
  }
</style>
