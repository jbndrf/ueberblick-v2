/**
 * The draft edit of the GeoJSON wizard (v3's `importCollection` created the collection first, `feature-store/import.ts:
 * 91-128`): the new type and the task that creates it, as two `add` ops on the overlay. The keys are chosen against the
 * draft's effective file, so a name that exists gets the next free key. Pure; core's `importedType` builds the entries.
 */
import {
  importedType,
  keyFromName,
  type ImportedType,
  type ImportedTypeInput,
  type TemplateFile,
} from '@ueberblick/core';
import { addTypeOp } from '../../../routes/(admin)/admin/shell/sidebar-types';

export interface ImportedTypeEdit {
  readonly ops: readonly ReturnType<typeof addTypeOp>[];
  readonly result: { readonly typeKey: string; readonly mapping: ImportedType['mapping'] };
}

export const importedTypeEdit =
  (input: ImportedTypeInput) =>
  (effective: TemplateFile): ImportedTypeEdit => {
    const typeKey = keyFromName(input.name, Object.keys(effective.types ?? {}), 'objektart');
    const made = importedType(input, typeKey, Object.keys(effective.tasks ?? {}));
    return {
      ops: [
        addTypeOp(typeKey, made.type),
        { kind: 'add' as const, path: `tasks.${made.taskKey}`, value: made.task },
      ],
      result: { typeKey, mapping: made.mapping },
    };
  };
