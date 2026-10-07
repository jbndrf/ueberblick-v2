/** Checks for personal properties (`personal: { subject }`): subject targets, indexes, exposure. */
import type { TemplateFile } from '../file';
import type { Sink } from './problems';

type See = NonNullable<TemplateFile['types']>[string]['permissions'] extends infer P
  ? P extends { see?: infer S }
    ? S
    : never
  : never;

/**
 * Who sees a property, as docs/05 defines `see`: a whole-type audience applies to every property;
 * in a map, a property that is not listed stays visible to every role that sees the feature, which
 * the map does not narrow, so it counts as `$all`. An absent `see` denies everyone (F6), so `undefined`.
 */
function effectiveSee(see: See, pk: string): unknown {
  if (see === undefined) return undefined;
  if (typeof see === 'object' && !Array.isArray(see)) return see[pk] ?? '$all';
  return see;
}

/** Warns once when personal properties exist but no task can erase them (A-021: erasure is a `redact` step). */
function checkRedactable(file: TemplateFile, sink: Sink): void {
  const personal = Object.entries(file.types ?? {}).flatMap(([tk, type]) =>
    Object.entries(type.properties)
      .filter(([, p]) => p.personal !== undefined)
      .map(([pk]) => `${tk}.${pk}`),
  );
  const first = personal[0];
  if (first === undefined) return;
  const hasRedact = Object.values(file.tasks ?? {}).some((t) =>
    (t.then ?? []).some((s) => s.redact !== undefined),
  );
  if (hasRedact) return;
  const [tk, pk] = first.split('.');
  sink.warn(
    `types.${tk}.properties.${pk}.personal`,
    'personal_without_redact',
    `personal properties ${personal.join(', ')} cannot be erased: no task has a redact step`,
    'add a task with a redact step (then: [{ redact: { subject, of } }])',
    { properties: personal.join(', ') },
  );
}

export function checkPersonal(file: TemplateFile, sink: Sink): void {
  checkRedactable(file, sink);
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    const see = type.permissions?.see;
    for (const [pk, p] of Object.entries(type.properties)) {
      if (p.personal === undefined) continue;
      const base = `types.${tk}.properties.${pk}.personal`;
      const [kind, target] = p.personal.subject.split(':');
      if (kind === 'property' && target !== undefined && type.properties[target]?.type !== 'participant') {
        const known = Object.entries(type.properties)
          .filter(([, q]) => q.type === 'participant')
          .map(([k]) => k);
        sink.dangling(`${base}.subject`, 'participant_property_of', target, known, { of: tk });
      }
      if (p.index === true) {
        sink.warn(
          base,
          'personal_indexed',
          `personal property '${pk}' has an index`,
          'remove `index: true`: an index keeps personal values searchable and harder to erase',
          { property: pk },
        );
      }
      if (effectiveSee(see, pk) !== '$all') continue;
      for (const [vk, view] of Object.entries(file.views ?? {})) {
        if (view.source.type !== tk) continue;
        if (view.properties !== undefined && !view.properties.includes(pk)) continue;
        sink.warn(
          `views.${vk}`,
          'personal_public',
          `view '${vk}' carries personal property '${tk}.${pk}' that every role can see`,
          `list the properties of the view without '${pk}', or restrict it with permissions.see to roles that need it`,
          { view: vk, type: tk, property: pk },
        );
      }
    }
  }
}
