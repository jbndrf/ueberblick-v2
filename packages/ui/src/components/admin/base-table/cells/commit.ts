import { toast } from 'svelte-sonner';
import { m } from '../../../../paraglide/messages.js';
import type { CellProps } from '../types';

/** A save the page refused with a reason of its own (the server's message): the cell shows it instead of the generic one. */
export class CellRefusal extends Error {}

/** Saves one cell value through the table's callback; true when it worked. Shows v3's "saved" / failure toast. */
export async function commitCell(
  props: Pick<CellProps, 'onSave' | 'silent'>,
  value: unknown,
): Promise<boolean> {
  try {
    await props.onSave(value);
    if (!props.silent) toast.success(m.table_saved());
    return true;
  } catch (error) {
    console.error('Error updating cell:', error);
    toast.error(error instanceof CellRefusal ? error.message : m.table_save_failed());
    return false;
  }
}
