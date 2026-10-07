/** Registries of the differential check (R6): what kind of difference, and why it exists. */
import { defineRegistry, type KeyOf } from '@ueberblick/core';

export const DIFF_KINDS = defineRegistry([
  { key: 'outcome', description: 'v3 accepted the run and v4 refused it, or the other way round.' },
  { key: 'value', description: 'Both accepted; a resulting value differs.' },
  { key: 'stage', description: 'Both accepted; the resulting stage differs.' },
  { key: 'not_replayable', description: 'The run cannot be replayed through the converted project.' },
] as const);
export type DiffKind = KeyOf<typeof DIFF_KINDS>;

export const DIFF_CAUSES = defineRegistry([
  {
    key: 'reported',
    description:
      'The conversion report lists an approximated or dropped item on the task; its reason is attached.',
  },
  {
    key: 'known',
    description:
      'The run carries a note (`recorded.known`) from the person who curated it: why v4 differs, and what follows.',
  },
  {
    key: 'not_convertible',
    description: 'The run names a task, field, option or value that the conversion has no counterpart for.',
  },
  {
    key: 'unexplained',
    description:
      'No report item explains it: a converter bug, a v3 quirk or a wrong recording. Must be fixed or explained.',
  },
] as const);
export type DiffCause = KeyOf<typeof DIFF_CAUSES>;

/** How v3 recorded the result of a run. */
export const RECORDED_OUTCOMES = defineRegistry([
  { key: 'accepted', description: 'v3 accepted the run.' },
  { key: 'refused', description: 'v3 refused the run.' },
] as const);
export type RecordedOutcome = KeyOf<typeof RECORDED_OUTCOMES>;
