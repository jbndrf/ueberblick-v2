import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildSbom, purl, readTree } from './sbom.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));
const CDX = 'node_modules/@cyclonedx/cyclonedx-library/res/schema/';

function cdxValidator() {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const base = 'http://cyclonedx.org/schema/';
  ajv.addSchema(readJson(`${CDX}spdx.SNAPSHOT.schema.json`), `${base}spdx.SNAPSHOT.schema.json`);
  ajv.addSchema(readJson(`${CDX}jsf-0.82.SNAPSHOT.schema.json`), `${base}jsf-0.82.SNAPSHOT.schema.json`);
  return ajv.compile(readJson(`${CDX}bom-1.5.SNAPSHOT.schema.json`));
}

describe('sbom', () => {
  it('purl encodes scopes', () => {
    expect(purl('@scope/x', '1.0.0')).toBe('pkg:npm/%40scope/x@1.0.0');
  });

  it('builds a valid CycloneDX 1.5 document from a committed npm ls fixture', () => {
    const tree = readJson('scripts/sbom.fixture.json');
    const sbom = buildSbom(tree, {
      licensesFor: () => [{ license: { id: 'MIT' } }],
      now: new Date('2026-01-01T00:00:00Z'),
      serial: '00000000-0000-4000-8000-000000000000',
    });
    const validate = cdxValidator();
    expect(validate(sbom), JSON.stringify(validate.errors)).toBe(true);
    const names = sbom.components.map((c) => c.name).sort();
    expect(names).toEqual(['@scope/pkg', '@ueberblick/core', '@ueberblick/server', 'tiny', 'zod']);
    expect(names).not.toContain('left-pad');
    expect(names).not.toContain('vitest');
  });

  describe('readTree', () => {
    const fail =
      (stdout, stderr = 'npm ERR! boom') =>
      () => {
        throw Object.assign(new Error('exit'), { status: 1, stdout, stderr });
      };
    const tree = readJson('scripts/sbom.fixture.json');
    const problems = readJson('scripts/sbom.problems.fixture.json');

    it('tolerates a non-zero exit that still printed a valid tree', () => {
      expect(problems.problems.length).toBeGreaterThan(0);
      expect(readTree('.', fail(JSON.stringify(problems)))).toEqual(problems);
    });
    it('returns the tree on a zero exit', () => {
      expect(readTree('.', () => JSON.stringify(tree))).toEqual(tree);
    });
    it('throws with status and stderr on non-zero exit with empty stdout', () => {
      expect(() => readTree('.', fail('', 'ENOENT lockfile'))).toThrow(/status 1[\s\S]*ENOENT lockfile/);
    });
    it('throws when non-zero stdout is an error object, not a tree', () => {
      expect(() => readTree('.', fail('{"error":{"code":"EJSONPARSE"}}'))).toThrow(/status 1[\s\S]*boom/);
    });
  });

  it('smoke: real npm ls yields valid JSON (no content assertions)', () => {
    expect(() => JSON.stringify(readTree())).not.toThrow();
  });
});

describe('publiccode.yml', () => {
  it('validates against the publiccode.yml schema', () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(readJson('scripts/schemas/publiccode.schema.json'));
    const doc = parse(read('publiccode.yml'));
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it('names the owner-decided licence (O7: AGPL-3.0) and ships its text', () => {
    expect(read('publiccode.yml')).toMatch(/license: AGPL-3\.0-only/);
    expect(read('LICENSE')).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/);
  });
});

describe('ops/security.txt', () => {
  const fields = Object.fromEntries(
    read('ops/security.txt')
      .split('\n')
      .filter((l) => l !== '' && !l.startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]),
  );

  it('has the RFC 9116 fields', () => {
    expect(fields.Contact).toBeTruthy();
    expect(fields.Policy).toMatch(/^https:\/\//);
    expect(fields['Preferred-Languages']).toBe('de, en');
    expect(Number.isNaN(Date.parse(fields.Expires))).toBe(false);
  });

  it('Expires is at least 30 days away', () => {
    const days = (Date.parse(fields.Expires) - Date.now()) / 86_400_000;
    expect(days, 'bump Expires in ops/security.txt').toBeGreaterThanOrEqual(30);
  });
});

describe('SECURITY.md', () => {
  const text = read('SECURITY.md');
  it('describes channel, response times, GHSA/CVE and marks placeholders', () => {
    expect(text).toMatch(/Reporting a vulnerability/);
    expect(text).toMatch(/Response times/);
    expect(text).toMatch(/GHSA/);
    expect(text).toMatch(/CVE/);
    expect(text).toMatch(/needs-owner/);
  });
});
