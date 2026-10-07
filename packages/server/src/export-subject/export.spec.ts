import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import Ajv from 'ajv';
import committed from './manifest.schema.json?raw';
import { exportSubject, ManifestSchema, manifestJsonSchema, type Manifest } from './index';
import { collectBytes, readZip } from './zip-reader.testkit';
import { world, type World } from './world.testkit';

const dec = new TextDecoder();
const MANIFEST_JSON_SCHEMA: unknown = JSON.parse(committed);
const disposables: World[] = [];
afterEach(() => {
  for (const w of disposables.splice(0)) w.dispose();
});
const make = (): World => {
  const w = world();
  disposables.push(w);
  return w;
};
const lines = (b: Uint8Array | undefined): Record<string, unknown>[] =>
  dec
    .decode(b)
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
async function zipOf(w: World, subject: string, admin = 'admin-1'): Promise<Map<string, Uint8Array>> {
  return readZip(await collectBytes(exportSubject(w.project, subject, admin)));
}
const manifestOf = (z: Map<string, Uint8Array>): Manifest =>
  ManifestSchema.parse(JSON.parse(dec.decode(z.get('manifest.json'))));

describe('exportSubject', () => {
  it('contains the subject runs and every observation they made, current and history', async () => {
    const w = make();
    w.participant('p1', 'Anna');
    w.run('r1', 'p1');
    w.run('r2', 'p1', 'aendern', 'rejected');
    w.obs('r1', 'f1', 'melder', 'p1');
    w.obs('r1', 'f1', 'titel', 'Loch');
    w.obs('r2', 'f1', 'titel', 'Grosses Loch');
    const z = await zipOf(w, 'p1');
    const obs = lines(z.get('observations.ndjson'));
    expect(obs.map((o) => [o.property, o.value, o.via])).toEqual([
      ['melder', 'p1', 'run'],
      ['titel', 'Loch', 'run'],
      ['titel', 'Grosses Loch', 'run'],
    ]);
    expect(obs[0]).toMatchObject({
      feature: 'f1',
      run: 'r1',
      task: 'melden',
      phenomenon_time: expect.any(String),
    });
    const runs = lines(z.get('runs.ndjson'));
    expect(runs.map((r) => [r.id, r.outcome])).toEqual([
      ['r1', 'accepted'],
      ['r2', 'rejected'],
    ]);
    expect(runs[0]).toMatchObject({ input: { by: 'p1' }, task: 'melden' });
    expect(JSON.parse(dec.decode(z.get('participant.json')))).toMatchObject({
      id: 'p1',
      name: 'Anna',
      roles: ['melder'],
    });
  });

  it('adds personal properties written by others while the subject was the named participant', async () => {
    const w = make();
    w.feature('f1', 'meldung');
    w.run('a', 'boss');
    w.run('b', 'boss');
    w.run('c', 'boss');
    w.run('d', 'boss');
    w.obs('a', 'f1', 'zustaendig', 'p1');
    const s1 = w.obs('b', 'f1', 'kontakt', '0151-p1');
    w.obs('c', 'f1', 'zustaendig', 'p2');
    w.obs('d', 'f1', 'kontakt', '0152-p2');
    const z = await zipOf(w, 'p1');
    const obs = lines(z.get('observations.ndjson'));
    expect(obs.map((o) => [o.seq, o.value, o.via])).toEqual([[s1, '0151-p1', 'named']]);
    expect(obs[0]).not.toHaveProperty('run');
    expect(lines(z.get('runs.ndjson'))).toEqual([]);
  });

  it('for a feature subject includes the personal properties of that feature only', async () => {
    const w = make();
    w.feature('person-1', 'person');
    w.feature('person-2', 'person');
    w.run('a', 'boss');
    w.obs('a', 'person-1', 'name', 'Eva');
    w.obs('a', 'person-1', 'notiz', 'nicht personenbezogen');
    w.obs('a', 'person-2', 'name', 'Uwe');
    const z = await zipOf(w, 'person-1');
    expect(lines(z.get('observations.ndjson')).map((o) => o.value)).toEqual(['Eva']);
  });

  it('includes attachments by sha256, reports a missing blob, and lists them in the manifest', async () => {
    const w = make();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const sha = await w.put(bytes, 'image/jpeg');
    const gone = 'f'.repeat(64);
    w.run('r1', 'p1');
    w.obs('r1', 'f1', 'foto', { sha256: sha, mime: 'image/jpeg' });
    w.obs('r1', 'f1', 'foto', { sha256: gone });
    const z = await zipOf(w, 'p1');
    expect([...(z.get(`blobs/${sha}.jpg`) ?? [])]).toEqual([1, 2, 3, 4]);
    const m = manifestOf(z);
    expect(m.files.find((f) => f.kind === 'blob')).toMatchObject({
      path: `blobs/${sha}.jpg`,
      sha256: sha,
      bytes: 4,
    });
    expect(m.missing_blobs).toEqual([gone]);
  });

  it('writes features.geojson with the subject values and geometry only', async () => {
    const w = make();
    w.feature('f1', 'meldung');
    w.run('r1', 'p1');
    w.run('r2', 'boss');
    w.obs('r1', 'f1', 'titel', 'Loch');
    w.obs('r1', 'f1', 'lage', { type: 'Point', coordinates: [8, 50] });
    w.obs('r2', 'f1', 'titel', 'ueberschrieben von boss');
    const g = JSON.parse(dec.decode((await zipOf(w, 'p1')).get('features.geojson'))) as {
      type: string;
      features: { id: string; geometry: unknown; properties: Record<string, unknown> }[];
    };
    expect(g.type).toBe('FeatureCollection');
    expect(g.features).toEqual([
      {
        type: 'Feature',
        id: 'f1',
        geometry: { type: 'Point', coordinates: [8, 50] },
        properties: { titel: 'Loch', $type: 'meldung' },
      },
    ]);
  });

  it('manifest validates against its JSON Schema and names files, labels and version', async () => {
    const w = make();
    w.run('r1', 'p1');
    w.obs('r1', 'f1', 'titel', 'x');
    const z = await zipOf(w, 'p1');
    const raw: unknown = JSON.parse(dec.decode(z.get('manifest.json')));
    const validate = new Ajv({ strict: true }).compile(MANIFEST_JSON_SCHEMA as object);
    expect(validate(raw), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...(raw as object), format: 'other' })).toBe(false);
    const m = manifestOf(z);
    expect(m).toMatchObject({
      format: 'ueberblick-subject-export',
      version: 1,
      project: 'demo',
      config_version: 3,
      subject: { id: 'p1' },
    });
    expect(m.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(['observations.ndjson', 'runs.ndjson', 'features.geojson']),
    );
    expect(m.files.find((f) => f.path === 'observations.ndjson')?.records).toBe(1);
    expect(m.properties).toContainEqual({
      type: 'meldung',
      property: 'melder',
      subject: 'actor',
      label: { de: 'Melder', en: 'Reporter' },
    });
    expect([...z.keys()].sort()).toEqual([...m.files.map((f) => f.path), 'manifest.json'].sort());
  });

  it('the checked-in JSON Schema is the generated one', () => {
    expect(
      MANIFEST_JSON_SCHEMA,
      'regenerate manifest.schema.json from manifestJsonSchema() (see the server README)',
    ).toEqual(manifestJsonSchema());
  });

  it('logs the access with actor and subject id and no values', async () => {
    const w = make();
    w.run('r1', 'p1');
    w.obs('r1', 'f1', 'titel', 'Geheimwert-42');
    await zipOf(w, 'p1', 'admin-7');
    expect(w.log).toEqual([
      { at: '2026-09-30T10:00:00.000Z', actor: 'admin-7', action: 'export_subject', subject: 'p1' },
    ]);
    const rows = w.db.prepare('SELECT * FROM access_log').all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Geheimwert-42');
  });

  it('logs even when the subject holds no data, and exports an empty but valid ZIP', async () => {
    const w = make();
    const z = await zipOf(w, 'nobody');
    expect(lines(z.get('observations.ndjson'))).toEqual([]);
    expect(z.has('participant.json')).toBe(false);
    expect(w.log).toHaveLength(1);
  });

  it('leaves out a personal value the subject wrote about someone else, in observations, features and runs', async () => {
    const w = make();
    w.feature('f1', 'meldung');
    w.run('a', 'boss');
    w.obs('a', 'f1', 'zustaendig', 'p2');
    w.run('b', 'p1', 'aendern', 'accepted', { titel: 'Loch', kontakt: '0152-p2' });
    w.obs('b', 'f1', 'titel', 'Loch');
    w.obs('b', 'f1', 'kontakt', '0152-p2');
    w.run(
      'c',
      'p1',
      'aendern',
      'rejected',
      { kontakt: '0153-unbekannt', titel: 'x' },
      { refusal: { code: 'x' } },
    );
    const z = await zipOf(w, 'p1');
    expect(lines(z.get('observations.ndjson')).map((o) => o.property)).toEqual(['titel']);
    const all = [...z.values()].map((b) => dec.decode(b)).join('\n');
    expect(all).not.toContain('0152-p2');
    expect(all).not.toContain('0153-unbekannt');
    const runs = lines(z.get('runs.ndjson'));
    expect(runs[0]?.input).toEqual({ titel: 'Loch', kontakt: { $redacted: 'other_subject' } });
    expect(runs[1]?.input).toEqual({ kontakt: { $redacted: 'other_subject' }, titel: 'x' });
    // the person it is about does get it, as a named observation without the author's run
    const z2 = await zipOf(w, 'p2');
    expect(lines(z2.get('observations.ndjson')).map((o) => [o.value, o.via])).toEqual([['0152-p2', 'named']]);
  });

  it('keeps a personal value the subject wrote about themselves, and actor-kind values', async () => {
    const w = make();
    w.feature('f1', 'meldung');
    w.run('r', 'p1', 'melden', 'accepted', { melder: 'p1', kontakt: '0151-p1' });
    w.obs('r', 'f1', 'zustaendig', 'p1');
    w.obs('r', 'f1', 'kontakt', '0151-p1');
    w.obs('r', 'f1', 'melder', 'p1');
    const z = await zipOf(w, 'p1');
    expect(lines(z.get('observations.ndjson')).map((o) => o.property)).toEqual([
      'zustaendig',
      'kontakt',
      'melder',
    ]);
    expect(lines(z.get('runs.ndjson'))[0]?.input).toEqual({ melder: 'p1', kontakt: '0151-p1' });
  });

  it('leaves out the personal property of another feature-kind subject that the participant edited', async () => {
    const w = make();
    w.feature('person-2', 'person');
    w.run('r', 'p1', 'aendern', 'accepted', { name: 'Uwe Geheim', notiz: 'ok' });
    w.obs('r', 'person-2', 'name', 'Uwe Geheim');
    w.obs('r', 'person-2', 'notiz', 'ok');
    const z = await zipOf(w, 'p1');
    expect(lines(z.get('observations.ndjson')).map((o) => o.property)).toEqual(['notiz']);
    expect(lines(z.get('runs.ndjson'))[0]?.input).toEqual({
      name: { $redacted: 'other_subject' },
      notiz: 'ok',
    });
    expect([...z.values()].map((b) => dec.decode(b)).join('')).not.toContain('Uwe Geheim');
    const z2 = await zipOf(w, 'person-2');
    expect(lines(z2.get('observations.ndjson')).map((o) => o.value)).toEqual(['Uwe Geheim']);
  });

  it('holds exactly the subject data and nothing about other subjects (property, tagged oracle)', async () => {
    // Oracle: every kontakt value carries a tag naming who it is about, computed by this model when it is
    // written (the participant last named in `zustaendig` on that feature, or nobody). The implementation
    // never sees the tag; it must reach the same answer from the data alone.
    const people = ['p1', 'p2', 'p3'] as const;
    const step = fc.record({
      actor: fc.constantFrom(...people),
      prop: fc.constantFrom('titel', 'melder', 'zustaendig', 'kontakt'),
      feature: fc.constantFrom('f1', 'f2'),
      named: fc.constantFrom(...people),
    });
    await fc.assert(
      fc.asyncProperty(
        fc.array(step, { maxLength: 30 }),
        fc.constantFrom(...people),
        async (steps, subject) => {
          const w = world();
          try {
            w.feature('f1', 'meldung');
            w.feature('f2', 'meldung');
            const named = new Map<string, string>();
            const written: { i: number; about: string | null; text: string; prop: string; actor: string }[] =
              [];
            steps.forEach((s, i) => {
              const about = s.prop === 'kontakt' ? (named.get(s.feature) ?? null) : null;
              const text =
                s.prop === 'zustaendig'
                  ? s.named
                  : s.prop === 'kontakt'
                    ? `kontakt-about-${about ?? 'nobody'}-${i}`
                    : `plain-${s.actor}-${i}`;
              w.run(`r${i}`, s.actor, 'melden', 'accepted', { [s.prop]: text });
              w.obs(`r${i}`, s.feature, s.prop, text);
              if (s.prop === 'zustaendig') named.set(s.feature, s.named);
              written.push({ i, about, text, prop: s.prop, actor: s.actor });
            });
            const z = readZip(await collectBytes(exportSubject(w.project, subject, 'admin')));
            const obs = lines(z.get('observations.ndjson')).map((o) => o.value);
            const runs = lines(z.get('runs.ndjson'));
            const features = dec.decode(z.get('features.geojson'));
            for (const x of written) {
              const inExport =
                x.prop === 'kontakt' ? x.about === subject : x.prop !== 'zustaendig' && x.actor === subject;
              const isZustaendig = x.prop === 'zustaendig';
              if (!isZustaendig) expect(obs.includes(x.text), `obs ${x.text}`).toBe(inExport);
              if (x.prop === 'kontakt' && x.about !== subject) {
                const every = [...z.entries()].filter(([n]) => n !== 'manifest.json');
                for (const [n, b] of every)
                  expect(dec.decode(b), `${n} leaks ${x.text}`).not.toContain(x.text);
                expect(features).not.toContain(x.text);
              }
              if (x.actor === subject) {
                const run = runs.find((r) => r.id === `r${x.i}`);
                const expected =
                  x.prop === 'kontakt' && x.about !== subject
                    ? { kontakt: { $redacted: 'other_subject' } }
                    : { [x.prop]: x.text };
                expect(run?.input, `run r${x.i}`).toEqual(expected);
              }
            }
            expect(runs.map((r) => r.id)).toEqual(
              written.filter((x) => x.actor === subject).map((x) => `r${x.i}`),
            );
          } finally {
            w.dispose();
          }
        },
      ),
      { numRuns: 80 },
    );
  });

  it('records the access when the export is requested, even if nobody reads the stream', () => {
    const w = make();
    w.run('r1', 'p1');
    w.obs('r1', 'f1', 'titel', 'x');
    exportSubject(w.project, 'p1', 'admin-3'); // not iterated
    expect(w.log).toHaveLength(1);
    expect(w.db.prepare('SELECT actor, subject FROM access_log').all()).toEqual([
      { actor: 'admin-3', subject: 'p1' },
    ]);
  });

  it('streams: 10k observations arrive in many chunks, none holding the archive', async () => {
    const w = make();
    w.run('r1', 'p1');
    w.db.transaction(() => {
      for (let i = 0; i < 10_000; i++) w.obs('r1', `f${i % 50}`, 'titel', `Wert ${i}`);
    });
    let chunks = 0;
    let largest = 0;
    let total = 0;
    for await (const c of exportSubject(w.project, 'p1', 'admin')) {
      chunks++;
      total += c.length;
      largest = Math.max(largest, c.length);
    }
    expect(chunks).toBeGreaterThan(5);
    expect(largest).toBeLessThan(total / 3);
  });
});
