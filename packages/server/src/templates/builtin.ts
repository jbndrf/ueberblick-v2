/**
 * Platform templates shipped with the server (WP-309). `leer` is the empty project: no types, so the admin
 * starts the configuration from nothing. Published idempotently through `publishTemplate` on first need.
 */
import { localize, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { publishTemplate } from './templates';

export const LEER_TEMPLATE: TemplateFile = {
  schema: 'ueberblick/1',
  template: { key: 'leer', version: '1.0.0', label: { de: 'Leeres Projekt', en: 'Empty project' } },
};

const BUILTIN: readonly TemplateFile[] = [LEER_TEMPLATE];

/** Publishes the built-in templates; a no-op when they are already stored. Throws if one is refused. */
export function ensureBuiltinTemplates(db: Db, clock: { now(): string }): void {
  for (const file of BUILTIN) {
    const r = publishTemplate(db, file, clock);
    if (!r.ok) throw new Error(`built-in template ${file.template.key} was refused`);
  }
}

export interface TemplateListing {
  readonly key: string;
  readonly version: string;
  readonly label: { readonly de: string; readonly en: string };
}

function bothLanguages(label: LocalizedString | undefined, key: string): TemplateListing['label'] {
  return { de: localize(label, ['de', 'en']) || key, en: localize(label, ['en', 'de']) || key };
}

const parts = (v: string): number[] => (v.split('-')[0] ?? '').split('.').map(Number);
const newer = (a: string, b: string): boolean => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
};

/** The published templates, the newest version per key, `leer` first, the rest by key. */
export function listTemplates(db: Db, clock: { now(): string }): readonly TemplateListing[] {
  ensureBuiltinTemplates(db, clock);
  const rows = db
    .prepare<{ key: string; version: string; source: string }>('SELECT key, version, source FROM templates')
    .all();
  const best = new Map<string, { version: string; source: string }>();
  for (const r of rows) {
    const cur = best.get(r.key);
    if (!cur || newer(r.version, cur.version)) best.set(r.key, r);
  }
  const out: TemplateListing[] = [...best.entries()].map(([key, r]) => {
    const file = JSON.parse(r.source) as TemplateFile;
    return { key, version: r.version, label: bothLanguages(file.template.label, key) };
  });
  const first = LEER_TEMPLATE.template.key;
  return out.sort((a, b) =>
    a.key === first ? -1 : b.key === first ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}
