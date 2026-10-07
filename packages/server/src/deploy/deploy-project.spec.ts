import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { TemplateFile } from '@ueberblick/core';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import { isPlanted } from '../../../../scripts/testing/plant.mjs';
import { openProjectDb } from '../db/open';
import { deployProject } from './deploy-project';

const template = embedGoldenRefs(
  parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml'),
      'utf8',
    ),
  ),
) as TemplateFile;
const clock = { now: () => '2026-09-30T08:00:00Z' };

describe('deployProject', () => {
  it('runs afterDeploy when a version is created, not when the same file is deployed again', () => {
    const db = openProjectDb(':memory:', 'p');
    let calls = 0;
    const deps = { clock, afterDeploy: () => void calls++ };
    expect(deployProject(db, template, 'a', deps)).toMatchObject({ ok: true, created: true });
    expect(calls).toBe(1);
    expect(deployProject(db, template, 'a', deps)).toMatchObject({ ok: true, created: false });
    expect(calls).toBe(1);
  });

  it('does not run afterDeploy for a refused deploy', () => {
    const db = openProjectDb(':memory:', 'p');
    let calls = 0;
    const r = deployProject(db, { extends: 'nope@1' } as unknown as TemplateFile, 'a', {
      clock,
      templates: { resolve: () => undefined },
      afterDeploy: () => void calls++,
    });
    expect(r.ok).toBe(false);
    expect(calls).toBe(0);
  });
});

describe('one deploy caller (R1)', () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (name === 'node_modules' || name === '.svelte-kit' || isPlanted(name)) return [];
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  it('no production code outside packages/server/src/deploy calls deploy()', () => {
    const files = [...walk(join(root, 'apps/web/src')), ...walk(join(root, 'packages/server/src'))]
      .map((f) => relative(root, f))
      .filter((f) => /\.ts$/.test(f) && !/\.spec\.ts$/.test(f) && !/testkit\.ts$/.test(f))
      .filter((f) => !f.startsWith('packages/server/src/deploy/'))
      .filter((f) => !f.endsWith('versions-client.ts') && !f.endsWith('admin/deploy/deploy-client.ts')); // fetch client methods, not the pipeline
    const offenders = files.filter((f) => /(^|[^.\w])deploy\(/.test(readFileSync(join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
