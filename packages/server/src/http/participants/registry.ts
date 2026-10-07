import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** Why a roster or credential operation was refused (R6). */
export const PARTICIPANT_ERRORS = defineRegistry([
  {
    key: 'invalid_id',
    description: 'The participant id is empty, too long or has characters outside A-Z a-z 0-9 . _ @ -.',
  },
  { key: 'invalid_role', description: 'A role is not a valid key.' },
  {
    key: 'unknown_role',
    description: 'A role is in neither the deployed config nor the draft of the project.',
  },
  { key: 'name_required', description: 'The participant has no name (v3: "Name is required").' },
  { key: 'invalid_email', description: 'The E-Mail has no @ (v3: "Invalid email format").' },
  { key: 'unknown_column', description: 'A value names a column the project does not define.' },
  { key: 'column_required', description: 'A required column has no value.' },
  { key: 'column_value_invalid', description: 'A column value does not match the type of its column.' },
  {
    key: 'invalid_columns',
    description: 'A column definition is malformed (key, label, type, default or duplicate).',
  },
  { key: 'invalid_expiry', description: 'The expiry is not a date in the future.' },
  { key: 'participant_exists', description: 'The roster already has this participant.' },
  { key: 'participant_unknown', description: 'The roster has no such participant.' },
  { key: 'participant_disabled', description: 'The participant is disabled; a QR login cannot be issued.' },
  { key: 'token_duplicate', description: 'The chosen token is already in use in this instance.' },
  { key: 'token_too_short', description: 'The chosen token is shorter than the minimum length.' },
  {
    key: 'token_invalid',
    description: 'The chosen token is too long or has characters outside A-Z a-z 0-9 _ -.',
  },
  { key: 'credential_none', description: 'The participant has no current login token.' },
] as const);
export type ParticipantErrorCode = KeyOf<typeof PARTICIPANT_ERRORS>;

/**
 * The types of a participant column, as in v3's custom-field manager (Text, Number, Boolean, Date). Server-local on
 * purpose (WP-310): only the roster uses it. A later "team" type is one more entry (H3, O12).
 */
export const PARTICIPANT_COLUMN_TYPES = defineRegistry([
  { key: 'text', description: 'Free text.' },
  { key: 'number', description: 'A finite number.' },
  { key: 'boolean', description: 'Yes or no.' },
  { key: 'date', description: 'A calendar date, YYYY-MM-DD.' },
] as const);
export type ParticipantColumnType = KeyOf<typeof PARTICIPANT_COLUMN_TYPES>;
