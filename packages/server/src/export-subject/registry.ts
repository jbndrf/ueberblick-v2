import { defineRegistry, type KeyOf } from '@ueberblick/core';

/**
 * Why a value in an export was replaced by a marker `{ "$redacted": <key> }` instead of being shown.
 * The file keeps its shape; the reader sees that something was left out and why.
 */
export const EXPORT_REDACTIONS = defineRegistry([
  {
    key: 'other_subject',
    description: 'A personal value that is about another person than the subject of the export.',
  },
] as const);
export type ExportRedaction = KeyOf<typeof EXPORT_REDACTIONS>;

/** The single key of a redaction marker object. */
export const REDACTION_KEY = '$redacted';

export const redactionMarker = (reason: ExportRedaction): Record<string, ExportRedaction> => ({
  [REDACTION_KEY]: reason,
});
