// Guard: the text the demo prints (handout + plan "Try" lines) only names routes that exist in apps/web/src/routes,
// and never speaks of things the app no longer has. Keeps DEMO.md from going stale silently.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { isKnown, loadCatalogue } from '../ui-strings-lint.mjs';
import { handoutText } from './handout.mjs';

const ROUTES = join(import.meta.dirname, '../../apps/web/src/routes');
const plan = JSON.parse(readFileSync(join(import.meta.dirname, 'plan.json'), 'utf8'));

/** Every directory below `dir` that holds a page or endpoint, as segment lists ((group) folders dropped). */
function routeTable(dir, segs = [], out = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && /^\+(page|server)\./.test(e.name))) out.push(segs);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const grouped = /^\(.*\)$/.test(e.name);
    routeTable(join(dir, e.name), grouped ? segs : [...segs, e.name], out);
  }
  return out;
}

const matches = (route, parts) =>
  route.length === parts.length && route.every((s, i) => /^\[.*\]$/.test(s) || s === parts[i]);

const sample = handoutText({
  addrs: ['192.168.0.5'],
  port: 4173,
  scheme: 'https',
  dir: 'DEMODIR',
  email: 'admin@example.org',
  password: 'pw',
  projects: plan.projects.map((p) => ({ key: p.key, title: p.title, try: p.try })),
  links: plan.projects.flatMap((p) =>
    p.participants.map((q) => ({ project: p.key, id: q.id, name: q.name, roles: q.roles, token: 'tok' })),
  ),
});
const text = `${sample}\n${plan.projects.map((p) => p.try).join('\n')}`;

/** Routes named in the text: a slash path after whitespace, "(", a host:port or a backtick, query dropped. */
const named = [...text.matchAll(/(?:^|[\s(`]|:\d+)(\/[a-z][a-z0-9\-/]*)/g)].map((m) =>
  m[1].replace(/\/$/, ''),
);

describe('demo text', () => {
  it('names at least the participant and admin entry', () => {
    expect(named).toContain('/map');
    expect(named).toContain('/admin');
  });

  it('only names routes that exist in apps/web/src/routes', () => {
    expect(existsSync(ROUTES)).toBe(true);
    const table = routeTable(ROUTES);
    for (const path of new Set(named)) {
      const parts = path.split('/').filter(Boolean);
      expect(
        table.some((r) => matches(r, parts)),
        `route ${path} does not exist`,
      ).toBe(true);
    }
  });

  it('has no words of earlier builds', () => {
    for (const stale of [
      '/builder/login',
      '#token',
      'one-time',
      'work once',
      'Meine Aufgaben',
      'Meine Einsätze',
      'Neue Aufgabe',
      'place the pin',
      'pick the type',
      'Offline packs',
      '"Ich"',
      'not ported',
      'not in the rebuilt app',
      'does nothing',
      'could not be loaded',
    ])
      expect(text, stale).not.toContain(stale);
  });
});

// Every quoted label is what the app shows: a message of a de catalogue (the same reader as `lint:ui-strings`),
// or a label the demo projects declare themselves (task, type and stage names are config, not catalogue).
const FIXTURES = join(import.meta.dirname, '../../fixtures/golden');
const QUOTE_RE = /"([^"\n]+)"|„([^“”\n]+)[“”]/g;

/** Every string value in the YAML files of the demo templates and projects. */
function configStrings() {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') out.add(v.trim());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  const files = plan.projects.map((p) => join(FIXTURES, 'projects', `${p.fixture}.yaml`));
  for (const dir of readdirSync(join(FIXTURES, 'templates')))
    for (const f of readdirSync(join(FIXTURES, 'templates', dir)))
      if (f.endsWith('.yaml')) files.push(join(FIXTURES, 'templates', dir, f));
  for (const f of files) walk(parse(readFileSync(f, 'utf8')));
  return out;
}

/** The quoted labels of `t` that no catalogue and no demo config knows. The admin password line is not a label. */
function unknownLabels(t, cat = loadCatalogue('de'), config = configStrings()) {
  const lines = t.split('\n').filter((l) => !l.startsWith('- Sign in at'));
  return [...lines.join('\n').matchAll(QUOTE_RE)]
    .map((m) => (m[1] ?? m[2]).trim())
    .filter((q) => !isKnown(q, cat) && !config.has(q));
}

describe('quoted labels', () => {
  it('are all in a de catalogue or in the demo config', () => {
    expect(unknownLabels(text)).toEqual([]);
  });

  it('fail for an invented label', () => {
    expect(unknownLabels('Tap "Erfundene Taste" and „Noch eine“.')).toEqual(['Erfundene Taste', 'Noch eine']);
  });

  it('name the labels a person taps in the try lines', () => {
    const tries = plan.projects.map((p) => p.try).join('\n');
    for (const label of ['Neu', 'Regelkontrolle', 'Zuweisen', 'Mangel melden', 'Veranstaltung beantragen'])
      expect(tries, label).toContain(`"${label}"`);
  });
});

describe('project names', () => {
  // The participant header shows the project's name when the template has no branding name; a bare key
  // (`musterstadt_baeume`) is what the owner saw on 2026-10-03.
  it('every demo project has a display name that is not its key', () => {
    for (const p of plan.projects) {
      expect(typeof p.name, p.key).toBe('string');
      expect(p.name.trim(), p.key).not.toBe('');
      expect(p.name, p.key).not.toBe(p.key);
    }
  });
});

describe('certificate step', () => {
  const base = {
    addrs: ['192.168.0.5'],
    port: 4173,
    dir: 'DEMODIR',
    email: 'admin@example.org',
    password: 'pw',
    projects: [],
    links: [],
  };
  it('https handout starts with installing the certificate', () => {
    const t = handoutText({ ...base, scheme: 'https' });
    expect(t).toContain('First: install the certificate');
    expect(t).toContain('https://192.168.0.5:4173/setup/zertifikat');
  });
  it('--http handout has no certificate step', () => {
    const t = handoutText({ ...base, scheme: 'http' });
    expect(t).not.toContain('First: install the certificate');
    expect(t).not.toContain('/setup/zertifikat');
  });
});
