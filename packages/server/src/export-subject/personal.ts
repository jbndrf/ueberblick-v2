import {
  PERSONAL_SUBJECT_KINDS,
  type LocalizedString,
  type PersonalSubjectKind,
  type TemplateFile,
} from '@ueberblick/core';

/** One property marked `personal: { subject }`, with the subject kind parsed from the registry key. */
export interface PersonalProperty {
  readonly type: string;
  readonly property: string;
  /** As written in the file: `actor`, `feature` or `property:<key>`. */
  readonly subject: string;
  readonly kind: PersonalSubjectKind;
  /** For `property:<key>`: the participant property that names the subject. */
  readonly via?: string;
  readonly label?: LocalizedString;
}

/** Every personal property of a config's file, in file order. Unknown kinds cannot occur (the schema rejects them). */
export function personalProperties(file: Pick<TemplateFile, 'types'>): PersonalProperty[] {
  const out: PersonalProperty[] = [];
  for (const [type, t] of Object.entries(file.types ?? {})) {
    for (const [property, p] of Object.entries(t.properties)) {
      if (p.personal === undefined) continue;
      const [kind, via] = p.personal.subject.split(':');
      if (kind === undefined || !PERSONAL_SUBJECT_KINDS.has(kind)) continue;
      out.push({
        type,
        property,
        subject: p.personal.subject,
        kind,
        ...(via === undefined ? {} : { via }),
        ...(p.label === undefined ? {} : { label: p.label }),
      });
    }
  }
  return out;
}
