import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { catalogueDirs } from './messages-sort.mjs';
import { IGNORE_MARK, checkDoc, loadCatalogue, scanDocs } from './ui-strings-lint.mjs';

const root = mkdtempSync(join(tmpdir(), 'ui-strings-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const msgDir = join(root, 'messages');
mkdirSync(msgDir);
writeFileSync(
  join(msgDir, 'en.json'),
  JSON.stringify({ $schema: 'x', a: 'Submit', b: '{count} unsent', c: 'Retrying in {s} s', d: 'Saved.' }),
);
writeFileSync(join(msgDir, 'de.json'), JSON.stringify({ a: 'Absenden', b: '{count} nicht gesendet' }));
const en = loadCatalogue('en', [msgDir]);
const de = loadCatalogue('de', [msgDir]);
const check = (text: string, cat = en): string[] => checkDoc(text, 'p.md', cat);

describe('ui-strings lint (WP-910)', () => {
  it('passes a quoted existing label', () => {
    expect(check('Tap "Submit".')).toEqual([]);
    expect(check('Tippen Sie „Absenden“.', de)).toEqual([]);
  });

  it('matches parameterised labels, abbreviations and a missing final full stop', () => {
    expect(check('It shows "3 unsent".')).toEqual([]);
    expect(check('It shows "Retrying in …".')).toEqual([]);
    expect(check('It shows "Retrying in ...".')).toEqual([]);
    expect(check('It says "Saved".')).toEqual([]);
  });

  it('reports a …/... spelling mismatch with the catalogue spelling (WP-977)', () => {
    writeFileSync(join(msgDir, 'dots.json'), '{}');
    const cat = loadCatalogue('en', [msgDir]);
    cat.exact.add('Saving to Downloads...');
    cat.exact.add('Loading…');
    expect(checkDoc('Shows "Saving to Downloads…".', 'p.md', cat)).toEqual([
      'p.md:1: "Saving to Downloads…" differs from the catalogue only in …/...: use "Saving to Downloads..."',
    ]);
    expect(checkDoc('Shows "Loading...".', 'p.md', cat)[0]).toContain('use "Loading…"');
    expect(checkDoc('Shows "Saving to Downloads...".', 'p.md', cat)).toEqual([]);
  });

  it('a catalogue value that is only a parameter matches nothing (WP-416 added "{detail_hint}")', () => {
    const dir = join(root, 'param-only');
    mkdirSync(dir);
    writeFileSync(join(dir, 'en.json'), JSON.stringify({ a: '{detail_hint}', b: '{x} {y}.', c: 'Submit' }));
    const cat = loadCatalogue('en', [dir]);
    expect(checkDoc('Tap "Send now".', 'p.md', cat)).toEqual([
      'p.md:1: "Send now" is in no message catalogue',
    ]);
    expect(checkDoc('Tap "Submit".', 'p.md', cat)).toEqual([]);
  });

  it('fails an invented label with file:line', () => {
    expect(check('ok\nTap "Send now".')).toEqual(['p.md:2: "Send now" is in no message catalogue']);
  });

  it('checks .en.md against en and other pages against de', () => {
    writeFileSync(join(root, 'a.md'), 'Tippen Sie „Absenden“.\n');
    writeFileSync(join(root, 'a.en.md'), 'Tap "Absenden".\n');
    writeFileSync(join(root, 'b.en.md'), 'Tap "Submit".\n');
    const { problems } = scanDocs(root, [msgDir]);
    expect(problems).toEqual([expect.stringMatching(/a\.en\.md:1: "Absenden"/)]);
  });

  it('scans only the given docs when the hook passes the staged files (WP-977 hotfix)', () => {
    writeFileSync(join(root, 'c.en.md'), 'Tap "Absenden".\n');
    writeFileSync(join(root, 'd.en.md'), 'Tap "Submit".\n');
    expect(scanDocs(root, [msgDir], [join(root, 'd.en.md')]).problems).toEqual([]);
    expect(scanDocs(root, [msgDir], [join(root, 'c.en.md')]).problems).toHaveLength(1);
    expect(scanDocs(root, [msgDir], ['elsewhere/x.md', join(root, 'notes.txt')]).files).toEqual([]);
  });

  it('honours the escape, code spans and fenced code', () => {
    expect(check(`Example "Nope" ${IGNORE_MARK}`)).toEqual([]);
    expect(check('Use `"Nope"` here.')).toEqual([]);
    expect(check('```\n"Nope"\n```')).toEqual([]);
    expect(check('"Nope"')).toHaveLength(1);
  });

  it('reads a catalogue per package (packages/*, packages/tools/*, apps/*); an invented label still fails', () => {
    const repo = mkdtempSync(join(tmpdir(), 'ui-strings-repo-'));
    try {
      const dirs = ['packages/ui', 'packages/tools/draw', 'apps/web'];
      for (const dir of dirs) {
        mkdirSync(join(repo, dir, 'messages'), { recursive: true });
        writeFileSync(join(repo, dir, 'messages', 'en.json'), JSON.stringify({ k: `Label of ${dir}` }));
      }
      mkdirSync(join(repo, 'packages/tools/bare'), { recursive: true }); // no messages folder: skipped
      const cat = loadCatalogue('en', catalogueDirs(repo));
      for (const dir of dirs) expect(checkDoc(`Tap "Label of ${dir}".`, 'p.md', cat)).toEqual([]);
      expect(checkDoc('Tap "Invented label".', 'p.md', cat)).toHaveLength(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('passes every current page of the repo quickly', () => {
    const t = performance.now();
    const { problems, files } = scanDocs();
    expect(files.length).toBeGreaterThan(20);
    expect(problems).toEqual([]);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
