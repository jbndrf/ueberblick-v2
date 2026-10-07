/**
 * View model of the simulate lens: pure functions from the effective file and the simulation result
 * to what the component draws. No DOM. The rules stay in core; this only shapes and parses.
 */
import {
  ACTOR_KINDS,
  type Actor,
  type Json,
  type Key,
  type PropertyTypeKey,
  type TemplateFile,
} from '@ueberblick/core';
import type { SimulatedRun, SimulationResult } from '../../simulate';

/** How a form entry's text becomes a value; one parser per way, chosen per property type (registry keys, R6). */
const PARSERS = {
  string: (text: string): Json => text,
  number: (text: string): Json => {
    const n = Number(text.trim());
    return Number.isFinite(n) ? n : text;
  },
  boolean: (text: string): Json => ['true', '1', 'yes'].includes(text.trim()),
  json: (text: string): Json => {
    try {
      return JSON.parse(text.trim()) as Json;
    } catch {
      return text;
    }
  },
} as const;

const PARSE: { readonly [K in PropertyTypeKey]: (typeof PARSERS)[keyof typeof PARSERS] } = {
  text: PARSERS.string,
  localized_text: PARSERS.json,
  number: PARSERS.number,
  integer: PARSERS.number,
  boolean: PARSERS.boolean,
  date: PARSERS.string,
  datetime: PARSERS.string,
  time: PARSERS.string,
  select: PARSERS.string,
  multiselect: PARSERS.json,
  geometry: PARSERS.json,
  participant: PARSERS.string,
  role: PARSERS.string,
  reference: PARSERS.string,
  file: PARSERS.string,
};

/** The value of a form entry typed as text; undefined for an empty entry (not submitted). */
export function parseInput(type: PropertyTypeKey, text: string): Json | undefined {
  return text.trim() === '' ? undefined : PARSE[type](text);
}

/** The task's form as `{ key, type }` in file order; a field whose property is unknown is treated as text. */
export function formFields(
  file: TemplateFile,
  task: string,
  type: string | undefined,
): readonly { key: string; type: PropertyTypeKey }[] {
  const form = file.tasks?.[task]?.form ?? {};
  const props = type === undefined ? {} : (file.types?.[type]?.properties ?? {});
  return Object.keys(form).map((key) => ({ key, type: (props[key]?.type ?? 'text') as PropertyTypeKey }));
}

export interface ActorChoice {
  /** The select value. */
  readonly value: string;
  readonly kind: 'role' | 'kind';
  readonly actor: Actor;
}

/** Who can be simulated: one participant per role in the file, then the other actor kinds. */
export function actorChoices(file: TemplateFile): readonly ActorChoice[] {
  const roles = Object.keys(file.roles ?? {}).map((role): ActorChoice => ({
    value: `role:${role}`,
    kind: 'role',
    actor: { id: `sim-${role}`, kind: 'participant', roles: [role as Key] },
  }));
  const kinds = ACTOR_KINDS.keys
    .filter((k) => k !== 'participant')
    .map((k): ActorChoice => ({
      value: `kind:${k}`,
      kind: 'kind',
      actor: { id: `sim-${k}`, kind: k, roles: [] },
    }));
  return [...roles, ...kinds];
}

/** A run of the result as a row: indent by depth. */
export interface RunRow {
  readonly run: SimulatedRun;
  readonly observationCount: number;
}

export const runRows = (r: Extract<SimulationResult, { ok: true }>): readonly RunRow[] =>
  r.runs.map((run) => ({ run, observationCount: run.observations.length }));
