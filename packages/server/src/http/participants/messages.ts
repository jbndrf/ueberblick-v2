import type { ParticipantErrorCode } from './registry';

const t = (en: string, de: string) => ({ en, de });

type Text = { readonly en: string; readonly de: string };

/** en and de text of every refusal (v3's wording where v3 had one). `detail` is the role or column it is about. */
const PARTICIPANT_MESSAGES: Readonly<Record<ParticipantErrorCode, (detail: string) => Text>> = {
  invalid_id: () => t('The participant id is not valid.', 'Die Teilnehmer-ID ist ungültig.'),
  invalid_role: (r) => t(`"${r}" is not a valid role key.`, `"${r}" ist kein gültiger Rollenschlüssel.`),
  unknown_role: (r) => t(`The project has no role "${r}".`, `Das Projekt hat keine Rolle "${r}".`),
  name_required: () => t('Name is required', 'Name ist erforderlich'),
  invalid_email: () => t('Invalid email format', 'Ungültiges E-Mail-Format'),
  unknown_column: (c) =>
    t(`The project has no participant column "${c}".`, `Das Projekt hat keine Teilnehmenden-Spalte "${c}".`),
  column_required: (c) => t(`"${c}" is required.`, `"${c}" ist ein Pflichtfeld.`),
  column_value_invalid: (c) =>
    t(`The value of "${c}" does not fit its type.`, `Der Wert von "${c}" passt nicht zum Feldtyp.`),
  invalid_columns: (c) =>
    t(`The column definition "${c}" is not valid.`, `Die Spaltendefinition "${c}" ist ungültig.`),
  invalid_expiry: () => t('The expiry must be a future date.', 'Das Ablaufdatum muss in der Zukunft liegen.'),
  participant_exists: () => t('This participant already exists.', 'Diese Person existiert bereits.'),
  participant_unknown: () => t('No such participant.', 'Diese Person gibt es nicht.'),
  participant_disabled: () => t('The participant is disabled.', 'Die Person ist deaktiviert.'),
  token_duplicate: () => t('This token is already in use.', 'Dieses Token wird bereits verwendet.'),
  token_too_short: () => t('The token is too short.', 'Das Token ist zu kurz.'),
  token_invalid: () =>
    t(
      'The token has invalid characters or is too long.',
      'Das Token enthält ungültige Zeichen oder ist zu lang.',
    ),
  credential_none: () => t('The participant has no login token.', 'Die Person hat kein Login-Token.'),
};

export const messageOf = (code: ParticipantErrorCode, detail = ''): Text =>
  PARTICIPANT_MESSAGES[code](detail);
