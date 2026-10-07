/**
 * The participant preview of a stage (v3 `ParticipantPreview.svelte`, WP-335): what a participant of
 * a chosen role sees for an Objekt in this stage. Computed from the file with the simulator and
 * `core.perms`, never fetched: a sandbox Objekt is generated in the stage, `availability` says which
 * tasks core offers the role (v3 only compared the task's role list, register `a3-builder` bug 11),
 * and the permissions say which properties the role reads and writes.
 */
import {
  ACTOR_KINDS,
  compilePerms,
  processesOf,
  type Actor,
  type Key,
  type TemplateFile,
} from '@ueberblick/core';
import { buttonColor } from '@ueberblick/ui';
import { pinnedOptions, taskOfferedOn } from '../../lenses/process/graph';
import { labelOf } from '../../shell/location';
import { openSimulation } from '../../simulate';
import { isAutomaticOnly, ownedTasks } from '../rule/auto-task';

/** The picker's "Alle Rollen": nothing is dimmed or hidden. */
export const ALL_ROLES = 'all';

export interface PreviewRole {
  readonly key: string;
  readonly label: string;
}

export interface PreviewButton {
  readonly key: string;
  readonly label: string;
  /** The task is pinned to this stage by its `when`. */
  readonly own: boolean;
  /** The task is offered in every stage (v3's global tool). */
  readonly global: boolean;
  /** Core does not offer it to the chosen role here. */
  readonly dimmed: boolean;
  /** The "why not" of a dimmed button. */
  readonly why?: string;
  /** Only the system runs it (C-004): drawn with the automatic mark, never pressable. */
  readonly automatic: boolean;
  /** The task's `button.color` as CSS (the participant app's `buttonColor`); absent: the plain button. */
  readonly color?: string;
}

export interface PreviewProperty {
  readonly key: string;
  readonly label: string;
  /** The role reads it (all roles: always). */
  readonly visible: boolean;
  /** The role may write it. */
  readonly editable: boolean;
}

export interface StagePreview {
  readonly buttons: readonly PreviewButton[];
  readonly properties: readonly PreviewProperty[];
}

export const previewRoles = (file: TemplateFile, locale: string): readonly PreviewRole[] =>
  Object.entries(file.roles ?? {}).map(([key, r]) => ({ key, label: labelOf(r.label, locale, key) }));

/** The probe: a participant holding exactly `role`. */
export const previewActor = (role: string): Actor => ({
  id: 'builder-preview',
  kind: ACTOR_KINDS.keys[0] ?? 'participant',
  roles: [role as Key],
});

const EMPTY: StagePreview = { buttons: [], properties: [] };

/**
 * `stage` null is v3's "Standardansicht" (nothing selected): the data only, no buttons.
 * A file that does not compile gives an empty preview; the problems badge says why.
 */
export function stagePreview(
  file: TemplateFile,
  type: string,
  stage: string | null,
  role: string,
  locale: string,
): StagePreview {
  const featureType = file.types?.[type];
  if (featureType === undefined) return EMPTY;
  const process = processesOf(featureType)[0];
  const opened = openSimulation(file);
  if (!opened.ok) return EMPTY;
  const sim = opened.simulation;
  const all = role === ALL_ROLES;

  const properties: PreviewProperty[] = [];
  const typePerms = compilePerms(sim.config).forType(type as Key);
  const actor = previewActor(all ? '' : role);
  const subjects = all ? [] : compilePerms(sim.config).subjects(actor);
  const readable = typePerms?.readable(subjects);
  const writable = typePerms?.writable(subjects);
  for (const [key, p] of Object.entries(featureType.properties)) {
    properties.push({
      key,
      label: labelOf(p.label, locale, key),
      visible: all || readable?.has(key) === true,
      editable: all || writable?.has(key) === true,
    });
  }
  if (stage === null || process === undefined) return { buttons: [], properties };

  const id = sim.generate(type as Key, { [process.property]: stage });
  const availability = new Map(sim.availability(id, actor).map((a) => [a.task as string, a]));
  const buttons: PreviewButton[] = [];
  // A rule's own task is its outcome, not an action of its own (C-004 step 1): no button.
  const owned = ownedTasks(file);
  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    if (owned.has(key)) continue;
    if (!taskOfferedOn(task, type)) continue;
    const pins = pinnedOptions(task.when, process.property);
    if (pins !== undefined && !pins.includes(stage)) continue;
    const a = availability.get(key);
    const automatic = isAutomaticOnly(file, key);
    const color = buttonColor(task.button?.color);
    const dimmed = !automatic && !all && a?.ok !== true;
    buttons.push({
      key,
      label: labelOf(task.label, locale, key),
      own: pins !== undefined,
      global: pins === undefined,
      dimmed,
      automatic,
      ...(color === undefined ? {} : { color }),
      ...(dimmed && a !== undefined && !a.ok ? { why: a.refusal.message } : {}),
    });
  }
  return { buttons, properties };
}
