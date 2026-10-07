import type { Key } from '@ueberblick/core/model';
import type { Choice, FormField } from '@ueberblick/ui';
import { participantChoice } from '@ueberblick/core';
import { allowedRoles } from '@ueberblick/core';
import { localize } from '@ueberblick/core/locale';
import type { Device } from '../device';
import { labelPeople, participantName } from '../people';
import { message, type Locale } from '../messages';

/**
 * Choices of participant and reference fields: the features of the referenced type on this device; for a participant
 * property v3's rule (`select`): everyone the sync shipped by name, only oneself, or nobody (WP-725).
 * One place for the task sheet, the multi-step flow and the inline quick edit (R1).
 */
export function choicesFor(
  device: Pick<Device, 'config' | 'actor' | 'participant' | 'store' | 'feature' | 'reader'>,
  type: Key | undefined,
  fields: readonly Pick<FormField, 'key'>[],
  locale: Locale,
): Record<string, readonly Choice[]> {
  const out: Record<string, readonly Choice[]> = {};
  const properties = type === undefined ? undefined : device.config.file.types?.[type]?.properties;
  for (const field of fields) {
    const property = properties?.[field.key];
    if (property?.type === 'participant') out[field.key] = participantChoices(device, property, locale);
    else if (property?.type === 'role') out[field.key] = roleChoices(device, property, locale);
    else if (property?.type === 'reference' && property.to !== undefined) {
      const to = property.to as Key;
      out[field.key] = [...device.store.featureIdsOfType(to)].flatMap((id) => {
        const state = device.feature(id);
        return state === undefined
          ? []
          : [{ value: id, label: device.reader.labelOf(state, locale, property) }];
      });
    }
  }
  return out;
}

/** A name the device does not know is never shown as an id: "Jemand", numbered so people stay apart (as the filter does). */
function participantChoices(
  device: Pick<Device, 'actor' | 'participant' | 'store'>,
  property: Parameters<typeof participantChoice>[0],
  locale: Locale,
): readonly Choice[] {
  const allowed = participantChoice(property, device.actor.roles);
  const unknown = message(locale, 'activity_unknown_actor');
  const nameOf = (id: string): string | undefined => {
    const name = participantName(
      {
        selfId: device.participant.id,
        selfName: device.participant.name,
        personName: (who) => device.store.personName(who),
      },
      id,
    );
    return name === '' ? undefined : name;
  };
  if (!allowed.everyone)
    return !allowed.oneself ? [] : [{ value: device.actor.id, label: nameOf(device.actor.id) ?? unknown }];
  const people = device.store
    .choosableParticipants()
    .map((p) => ({ id: p.id, name: nameOf(p.id) ?? (p.name !== '' ? p.name : undefined) }));
  return labelPeople(people, unknown).map((p) => ({ value: p.id, label: p.label }));
}

/** The roles of the file a caller may choose for a role property: v3's "Nur Selbstauswahl" / "Kann jeden auswählen" (WP-481). */
function roleChoices(
  device: Pick<Device, 'config' | 'actor'>,
  property: Parameters<typeof allowedRoles>[0],
  locale: Locale,
): readonly Choice[] {
  const roles = device.config.file.roles ?? {};
  return allowedRoles(property, device.actor.roles, Object.keys(roles)).flatMap((key) => {
    const role = roles[key];
    return role === undefined ? [] : [{ value: key, label: localize(role.label, [locale]) }];
  });
}
