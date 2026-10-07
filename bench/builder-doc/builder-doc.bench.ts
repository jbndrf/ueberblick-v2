/**
 * Budget (WP-200): one edit on the largest golden template -> new problems <= 50 ms (median).
 * Run: npm test -- -c bench/vitest.config.ts bench/builder-doc
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { openProject } from '../../packages/builder/src/doc';

describe('builder document: Code view on the largest golden template (WP-332)', () => {
  it('entityYaml of a type and applyEntityYaml with one change stay below one frame (16 ms)', () => {
    const doc = openProject(
      golden('templates/baumkataster/2.0.0.yaml'),
      'schema: ueberblick/1\nextends: baumkataster@2\n',
    );
    const edited = doc.entityYaml('types.baum').text.replace(/^label: .*$/m, 'label: Warm');
    doc.applyEntityYaml('types.baum', edited); // warm up
    const view: number[] = [];
    const typing: number[] = [];
    for (let i = 0; i < 30; i++) {
      let t = performance.now();
      doc.entityYaml('types.baum');
      view.push(performance.now() - t);
      t = performance.now();
      const r = doc.applyEntityYaml('types.baum', edited.replace('Warm', 'Warm ' + i));
      typing.push(performance.now() - t);
      expect(r.ok).toBe(true);
    }
    const ms = Math.max(med(view), med(typing));
    console.info(
      'builder-doc code view: entityYaml ' +
        med(view).toFixed(2) +
        ' ms, applyEntityYaml ' +
        med(typing).toFixed(2) +
        ' ms (median)',
    );
    assertBudget(
      report(
        defineBudget({
          id: 'builder-doc-code-view',
          limit: 16,
          unit: 'ms',
          derivedFrom: 'typing feedback: one frame budget for the Code view',
          device: 'dev-only',
          thread: 'main',
        }),
        Number(ms.toFixed(2)),
      ),
    );
  });
});

const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

const golden = (rel: string): string =>
  readFileSync(new URL(`../../fixtures/golden/${rel}`, import.meta.url), 'utf8');

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('builder document: single edit on the largest golden template', () => {
  it('apply(set) returns problems in <= 50 ms (median)', () => {
    const templates = [
      'baumkataster/2.0.0.yaml',
      'baumkataster/1.1.0.yaml',
      'maengelmelder/1.0.0.yaml',
      'veranstaltung/1.0.0.yaml',
    ];
    const [file, largest] = templates
      .map((f): [string, string] => [f, golden(`templates/${f}`)])
      .sort((a, b) => b[1].length - a[1].length)[0] as [string, string];
    // The overlay must extend the template it is opened on (key@major, from the file name).
    const [key, version] = file.replace(/\.yaml$/, '').split('/') as [string, string];
    const doc = openProject(largest, `schema: ueberblick/1\nextends: ${key}@${version.split('.')[0]}\n`);
    doc.apply({ kind: 'set', path: 'types.baum.label', value: 'Warm' }); // warm up
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      const r = doc.apply({ kind: 'set', path: 'types.baum.label', value: `Baum ${i}` });
      samples.push(performance.now() - t);
      expect(r.refused).toBeUndefined();
    }
    const ms = median(samples);
    console.info(`builder-doc apply: ${ms.toFixed(2)} ms median (${largest.length} bytes template)`);
    assertBudget(
      report(
        defineBudget({
          id: 'builder-doc-edit',
          limit: 50,
          unit: 'ms',
          derivedFrom:
            'interaction-to-next-paint: one builder edit; the builder is desktop tooling, not a device budget',
          device: 'dev-only',
          thread: 'main',
        }),
        Number(ms.toFixed(2)),
      ),
    );
  });
});
