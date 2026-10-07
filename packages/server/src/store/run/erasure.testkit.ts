/** A small project with personal values (a photo file and a phone number) and the `erase_subject` task of the golden maengelmelder. */
import type { Actor, Json, Key, TemplateFile } from '@ueberblick/core';
import { build, setup, type Ctx, type SetupOptions } from './testkit';

export const SHA = 'a'.repeat(64);
export const photo = (sha: string = SHA): Json => [{ sha256: sha, name: 'p.jpg', mime: 'image/jpeg' }];
export const mia: Actor = { id: 'mia', kind: 'participant', roles: ['melder' as Key] };
export const sabine: Actor = { id: 'sabine', kind: 'participant', roles: ['sachbearbeiter' as Key] };
export const root: Actor = { id: 'root', kind: 'admin', roles: [] };

const open = { see: '$all', create: '$all', write: '$all' } as const;

export const erasureTemplate = (): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    template: { key: 'erasure_run', version: '1.0.0' },
    roles: { melder: { label: 'Melder' }, sachbearbeiter: { label: 'Sachbearbeitung' } },
    types: {
      meldung: {
        label: 'Meldung',
        permissions: open,
        properties: {
          kategorie: { type: 'text' },
          foto: { type: 'file', personal: { subject: 'actor' } },
          telefon: { type: 'text', personal: { subject: 'actor' } },
        },
      },
      loeschung: {
        label: 'Loeschung',
        permissions: open,
        properties: {
          subject: { type: 'participant', select: { all: ['sachbearbeiter'] } },
          a: { type: 'participant', select: { all: ['sachbearbeiter'] } },
          b: { type: 'participant', select: { all: ['sachbearbeiter'] } },
        },
      },
    },
    tasks: {
      melden: {
        label: 'Melden',
        who: ['melder', 'sachbearbeiter'],
        on: '$none',
        creates: 'meldung',
        form: { kategorie: {}, foto: {}, telefon: {} },
      },
      erase_two: {
        label: 'Erase two people',
        on: '$none',
        who: ['admin'],
        creates: 'loeschung',
        form: { a: { required: true }, b: { required: true } },
        then: [
          { redact: { subject: 'actor', of: 'form.a' } },
          { redact: { subject: 'actor', of: 'form.b' } },
        ],
      },
      erase_subject: {
        label: 'Erase a person',
        on: '$none',
        who: ['sachbearbeiter', 'admin'],
        creates: 'loeschung',
        form: { subject: { required: true } },
        then: [{ redact: { subject: 'actor', of: 'form.subject' } }],
      },
    },
  }) as unknown as TemplateFile;

export interface World {
  readonly c: Ctx;
  readonly reportRun: string;
}

/** mia has reported once (photo, phone number); the photo blob row exists. */
export function world(over: SetupOptions = {}): World {
  const c = setup({ config: build(erasureTemplate()), ...over });
  for (const who of [mia, sabine])
    c.db.prepare("INSERT INTO participants (id, name, roles) VALUES (?, NULL, '[]')").run(who.id);
  c.db
    .prepare("INSERT INTO blobs (sha256, mime, bytes, created_at) VALUES (?, 'image/jpeg', 3, 'x')")
    .run(SHA);
  c.db
    .prepare(
      "INSERT INTO blob_uploads (sha256, actor, actor_kind, created_at) VALUES (?, 'mia', 'participant', 'x')",
    )
    .run(SHA);
  const r = c.store.submit(
    c.run('melden', mia, { kategorie: 'strasse', foto: photo(), telefon: '0151 123' }),
  );
  if (r.outcome !== 'accepted') throw new Error(JSON.stringify(r));
  return { c, reportRun: r.runId };
}

/** The erasure run (task `erase_subject`) for one subject. */
export const eraseRun = (c: Ctx, subject = 'mia', who: Actor = root) =>
  c.run('erase_subject', who, { subject });

/** All stored results of a property, oldest first. */
export const results = (c: Ctx, property: string): (string | null)[] =>
  c.db
    .prepare<{ result: string | null }>('SELECT result FROM observations WHERE property = ? ORDER BY seq')
    .all(property)
    .map((r) => r.result);

/** The personal values `world()` seeds: a phone number and a photo file name. */
export const PERSONAL_VALUES = ['0151 123', 'p.jpg'] as const;

/** True when a personal value appears in any string field of a log line. Numbers (`ms`, `t`) are never searched: a timing's digits are not a value. */
export const logsContain = (
  lines: readonly Record<string, string | number>[],
  values: readonly string[] = PERSONAL_VALUES,
): boolean =>
  lines.some((l) => Object.values(l).some((v) => typeof v === 'string' && values.some((p) => v.includes(p))));
