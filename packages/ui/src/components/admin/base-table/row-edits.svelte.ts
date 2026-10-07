// Row edits (WP-370, owner answer A1): in Bearbeitungsmodus a table with `onRowSave` collects the cell edits of a row
// and saves them together when the row's check button is pressed; the x button discards them. A refused save keeps
// the edits and marks the cells it names. (v3 saved every cell at once, `base-table.svelte` `onEdit`.)
import { toast } from 'svelte-sonner';
import { m } from '../../../paraglide/messages.js';
import type { TableRow } from './types';

/**
 * Thrown by `onRowSave` when the save was refused. `reasons` names the cells by column key; the cells show them and the
 * edits stay for correction. Without `reasons` (a stale row) only the message is shown.
 */
export class RowRefusal extends Error {
  readonly reasons: Readonly<Record<string, string>>;
  constructor(message: string, reasons: Readonly<Record<string, string>> = {}) {
    super(message);
    this.reasons = reasons;
  }
}

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

export class RowEdits {
  #pending = $state<Record<string, TableRow>>({});
  #errors = $state<Record<string, Record<string, string>>>({});
  #saving = $state<Record<string, boolean>>({});
  readonly #save: () => ((rowId: string, values: TableRow) => void | Promise<void>) | undefined;

  constructor(save: () => ((rowId: string, values: TableRow) => void | Promise<void>) | undefined) {
    this.#save = save;
  }

  /** Row editing is on when the table has `onRowSave`. */
  get enabled(): boolean {
    return this.#save() !== undefined;
  }

  has(rowId: string): boolean {
    return this.#pending[rowId] !== undefined;
  }

  saving(rowId: string): boolean {
    return this.#saving[rowId] === true;
  }

  /** The row as shown: its values with the pending edits on top. */
  row(rowId: string, original: TableRow): TableRow {
    const pending = this.#pending[rowId];
    return pending === undefined ? original : { ...original, ...pending };
  }

  error(rowId: string, key: string): string | undefined {
    return this.#errors[rowId]?.[key];
  }

  /** One cell edit. An edit back to the original value drops the pending value; the last drop ends the row's edit. */
  set(rowId: string, key: string, value: unknown, original: TableRow): void {
    const next = { ...this.#pending[rowId] };
    if (same(value, original[key])) Reflect.deleteProperty(next, key);
    else next[key] = value;
    if (Object.keys(next).length === 0) this.cancel(rowId);
    else this.#pending[rowId] = next;
    const errors = this.#errors[rowId];
    if (errors !== undefined && key in errors) {
      const rest = { ...errors };
      Reflect.deleteProperty(rest, key);
      this.#errors[rowId] = rest;
    }
  }

  cancel(rowId: string): void {
    Reflect.deleteProperty(this.#pending, rowId);
    Reflect.deleteProperty(this.#errors, rowId);
  }

  cancelAll(): void {
    this.#pending = {};
    this.#errors = {};
  }

  /** The row's check button: one save with all edited values. */
  async commit(rowId: string): Promise<void> {
    const save = this.#save();
    const values = this.#pending[rowId];
    if (save === undefined || values === undefined || this.saving(rowId)) return;
    this.#saving[rowId] = true;
    try {
      await save(rowId, { ...values });
      this.cancel(rowId);
      toast.success(m.table_saved());
    } catch (error) {
      if (error instanceof RowRefusal) {
        this.#errors[rowId] = { ...error.reasons };
        toast.error(error.message);
      } else {
        console.error('Error saving row:', error);
        toast.error(m.table_save_failed());
      }
    } finally {
      this.#saving[rowId] = false;
    }
  }
}
