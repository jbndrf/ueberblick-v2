/** `self.$created_by` and the other system fields (registry `SYSTEM_FIELDS`) as the `features` column they live in. */
import { systemFieldOf } from '../../registry/system-fields';
import type { Frag } from './frag';
import { columnFrag, type Row } from './values';

/** The column read of `row.<field>` when `field` names a system field, otherwise undefined. */
export function systemFrag(row: Row, field: string, fresh: () => string): Frag | undefined {
  const system = systemFieldOf(field);
  return system === undefined ? undefined : columnFrag(row, system.column, fresh);
}
