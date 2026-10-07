// @vitest-environment jsdom
// WP-554: every UI component is scanned with axe (WCAG 2.1 A/AA); a new .svelte file needs an entry in COVERED.
// jsdom has no layout, so contrast is proven from the tokens (tokens.spec.ts) and in the browser (e2e/a11y).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isPlanted } from '../../../scripts/testing/plant.mjs';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { FeatureId, Key, Property, TemplateFile } from '@ueberblick/core/model';
import { createGeo } from '@ueberblick/core/geo';
import { GEO_VALIDITY_ISSUES, STATUS_KINDS } from '@ueberblick/core/registry';
import Button from './components/Button.svelte';
import ErrorSummary from './components/ErrorSummary.svelte';
import Icon from './components/Icon.svelte';
import IconButton from './components/IconButton.svelte';
import { MODULE_SHELL_A11Y_CASES } from './components/module-shell/testing/a11y-cases.testing';
import Sheet from './components/Sheet.svelte';
import StatusBadge from './components/StatusBadge.svelte';
import TextField from './components/TextField.svelte';
import { FORM_A11Y_CASES } from './form/a11y-cases.testing';
import { STEPS_A11Y_CASES } from './form/steps/a11y-cases.testing';
import { buildFormModel } from './form/model';
import { evalContext, formWorld } from './form/form.testing';
import DrawOnMap from './map/draw/DrawOnMap.svelte';
import type { DrawLabels } from './map/draw/labels';
import FeatureList from './map/FeatureList.svelte';
import type { MapHandle } from './map/contract';
import { pointFeature } from './map/test-helpers';
import AppShell from './shell/testing/Harness.svelte';
import { deriveShellModel } from './shell/model';
import StatusIndicator from './shell/StatusIndicator.svelte';
import TaskSheetHarness from './task-sheet/testing/Harness.svelte';
import { fakeIds, fakeSubmitter, memoryDrafts } from './task-sheet/testing/ports';
import ToolMount from './tool-host/ToolMount.svelte';
import { createToolHost, webCryptoHash } from './tool-host/host';
import { defineTool } from './tool-host/define';
import { testPorts } from './tool-host/testing';
import { iconClock } from './icons';
import { text } from './testing/snippet';
import type { StatusModel } from './shell/contract';

afterEach(cleanup);

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['serious', 'critical']);

/** Serious and critical WCAG 2.1 A/AA violations of a rendered element (contrast is left to the browser run). */
async function wcagViolations(el: Element): Promise<string[]> {
  const r = await axe.run(el, { runOnly: WCAG_TAGS, rules: { 'color-contrast': { enabled: false } } });
  return r.violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    .map((v) => `${v.id} (${v.impact}): ${v.help} [${v.nodes.map((n) => n.target.join(' ')).join(', ')}]`);
}
const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;

const shellFile = {
  schema: '1',
  template: { key: 't', version: '1.0.0' },
  roles: {
    worker: {
      label: 'Worker',
      app: {
        home: 'mein',
        views: { mein: {}, alle: {} },
        tools: { photo: {} },
        shortcuts: { kontrolle: {} },
        ui: { theme: 'outdoor' },
      },
    },
  },
  views: { alle: { label: 'All trees' }, mein: { label: 'Mine' } },
  tools: { photo: {} },
  tasks: { kontrolle: { label: 'Inspection', on: { create: 'baum' } } },
} as unknown as TemplateFile;
const okStatus: StatusModel = {
  online: true,
  lastSyncedAt: '2026-09-29T08:00:00Z',
  pending: 0,
  oldestPendingAge: null,
  refused: [],
  storage: 'ok',
};
const shellProps = () => ({
  model: deriveShellModel({ file: shellFile, roleKey: 'worker', locale: 'en' }),
  status: okStatus,
  onexport: () => {},
});
const taskInput = {
  form: { vitalitaet: { required: true }, befund: {} },
  properties: { vitalitaet: P('integer', { label: 'Vitality' }), befund: P('text', { label: 'Finding' }) },
};
const taskProps = () => {
  const { config } = formWorld(taskInput, 'kontrolle' as Key);
  return {
    taskKey: 'kontrolle' as Key,
    model: buildFormModel(taskInput),
    config,
    ctx: evalContext(config),
    ids: fakeIds(),
    submitter: fakeSubmitter(0),
    drafts: memoryDrafts(),
    online: false,
    featureIds: ['f1' as FeatureId],
  };
};

const toolHost = createToolHost({
  loaders: {
    photo: async () =>
      defineTool({
        contributes: ['form-field'],
        key: 'photo',
        produces: 'file',
        mount(el) {
          const b = document.createElement('button');
          b.textContent = 'Take photo';
          el.append(b);
          return { destroy() {} };
        },
      }),
  },
  ports: testPorts({ hash: webCryptoHash }),
});
const toolField = (() => {
  const field = buildFormModel({
    form: { foto: { tool: 'photo' } },
    properties: { foto: P('file', { label: 'Photo' }) },
  }).fields[0];
  if (field === undefined) throw new Error('expected a field');
  return field;
})();

type Case = readonly [state: string, run: () => Promise<Element>];
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Every component file, keyed by its path below packages/ui/src, with the states worth scanning. */
const COVERED: Record<string, readonly Case[]> = {
  'components/Button.svelte': [
    ['primary', async () => render(Button, { children: text('Save') }).container],
    ['loading', async () => render(Button, { children: text('Save'), loading: true }).container],
    [
      'disabled danger',
      async () => render(Button, { children: text('X'), variant: 'danger', disabled: true }).container,
    ],
  ],
  'components/IconButton.svelte': [
    ['labelled', async () => render(IconButton, { icon: iconClock, label: 'P' }).container],
  ],
  'components/Icon.svelte': [
    ['decorative', async () => render(Icon, { icon: iconClock }).container],
    ['labelled', async () => render(Icon, { icon: iconClock, label: 'Pending' }).container],
  ],
  'components/TextField.svelte': [
    ['plain', async () => render(TextField, { id: 'a', label: 'A' }).container],
    [
      'error',
      async () =>
        render(TextField, { id: 'b', label: 'B', error: 'Bad', hint: 'H', required: true }).container,
    ],
  ],
  'components/ErrorSummary.svelte': [
    [
      'two errors',
      async () =>
        render(ErrorSummary, {
          errors: [
            { fieldId: 'f1', message: 'One' },
            { fieldId: 'f2', message: 'Two' },
          ],
        }).container,
    ],
  ],
  ...MODULE_SHELL_A11Y_CASES,
  'components/Sheet.svelte': [
    [
      'open',
      async () =>
        render(Sheet, { title: 'Details', open: true, onclose: () => {}, children: text('Body') })
          .baseElement,
    ],
  ],
  'components/StatusBadge.svelte': STATUS_KINDS.keys.map((status): Case => [
    `status ${status}`,
    async () => render(StatusBadge, { status }).container,
  ]),
  ...FORM_A11Y_CASES,
  ...STEPS_A11Y_CASES,
  'map/FeatureList.svelte': [
    [
      'list alternative',
      async () =>
        render(FeatureList, {
          features: [
            { ...pointFeature('a', 8, 50, { height: 12 }), name: 'Oak' },
            { ...pointFeature('b', 9, 51, { height: 30 }), name: 'Ash' },
          ],
          columns: [{ key: 'height', label: 'Height' }],
          labels: {
            caption: 'Trees',
            empty: 'None',
            sortedAscending: 'ascending',
            sortedDescending: 'descending',
            name: 'Name',
          },
          onFeatureTap: () => {},
        }).container,
    ],
  ],
  'map/draw/DrawOnMap.svelte': [
    [
      'multi-part stack',
      async () => {
        const main = document.body.appendChild(document.createElement('main'));
        const off = () => () => {};
        const labels: DrawLabels = {
          toolbar: 'Drawing tools',
          cancel: 'Cancel',
          newPart: 'New part',
          part: (n) => `Part ${n}`,
          undo: 'Undo',
          redo: 'Redo',
          delete: 'Delete part',
          finish: 'Done',
          refused: (r) => `Not accepted: ${r}`,
          issues: Object.fromEntries(GEO_VALIDITY_ISSUES.keys.map((k) => [k, k])) as DrawLabels['issues'],
        };
        return render(DrawOnMap, {
          target: main,
          props: {
            handle: {
              onMapTap: off,
              onMarkerDrag: off,
              showOverlay: () => {},
              clearOverlay: () => {},
              addMarker: () => {},
              moveMarker: () => {},
              removeMarker: () => {},
              setDoubleClickZoom: () => {},
            } as unknown as MapHandle,
            geo: createGeo(),
            kind: 'polygon',
            multi: true,
            labels,
            onconfirm: () => {},
            oncancel: () => {},
          },
        }).container;
      },
    ],
  ],
  'shell/AppShell.svelte': [
    ['online', async () => render(AppShell, shellProps()).container],
    [
      'assistant and feature slots',
      async () => render(AppShell, { ...shellProps(), withAssistant: true, withFeature: true }).container,
    ],
  ],
  'shell/StatusIndicator.svelte': [
    ['ok', async () => render(StatusIndicator, { status: okStatus, onexport: () => {} }).baseElement],
    [
      'offline, pending, refused, storage at risk',
      async () =>
        render(StatusIndicator, {
          status: {
            ...okStatus,
            online: false,
            pending: 2,
            oldestPendingAge: 1000,
            storage: 'at_risk',
            refused: [{ runId: 'r', reason: 'x' }],
          },
          onexport: () => {},
        }).baseElement,
    ],
  ],
  'task-sheet/TaskSheet.svelte': [
    [
      'editing',
      async () => {
        const v = render(TaskSheetHarness, taskProps());
        await tick();
        return v.container;
      },
    ],
  ],
  'tool-host/ToolMount.svelte': [
    [
      'mounted field tool',
      async () => {
        const v = render(ToolMount, {
          host: toolHost,
          slot: { field: toolField, value: undefined, set: () => {}, id: 'foto' },
        });
        await tick();
        await tick();
        return v.container;
      },
    ],
  ],
};

const HARNESS = /(^|\/)(testing|e2e)\//;
/** The v3 kit is scanned in components/ui/ui.a11y.spec.ts, the admin components in admin/base-table/base-table.spec.ts. */
const KIT = /^components\/(ui|admin)\//;

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (isPlanted(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? svelteFiles(p) : p.endsWith('.svelte') ? [p] : [];
  });
}
const SRC = join(process.cwd(), 'packages/ui/src');

describe('a11y coverage guard', () => {
  it('every component file has an axe scan below (add new components to COVERED)', () => {
    const files = svelteFiles(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !HARNESS.test(f) && !KIT.test(f))
      .sort();
    expect(files).toEqual(Object.keys(COVERED).sort());
  });
});

describe('axe, WCAG 2.1 A and AA, serious and critical', () => {
  for (const [file, cases] of Object.entries(COVERED)) {
    for (const [state, run] of cases) {
      it(`${file}: ${state}`, async () => {
        expect(await wcagViolations(await run())).toEqual([]);
      });
    }
  }

  it('the scan really fails on a control without a name (regression sensitivity)', async () => {
    const { container } = render(Icon, { icon: iconClock });
    container.append(document.createElement('button'));
    expect((await wcagViolations(container)).some((v) => v.startsWith('button-name'))).toBe(true);
  });
});

describe('source guards for criteria a scan cannot see', () => {
  const sources = svelteFiles(SRC).map((f) => [relative(SRC, f), readFileSync(f, 'utf8')] as const);
  const offenders = (re: RegExp) => sources.filter(([, src]) => re.test(src)).map(([f]) => f);

  it('text sizes are relative, so browser zoom and text-size settings apply (WCAG 1.4.4)', () => {
    expect(offenders(/font-size:\s*[\d.]+px/)).toEqual([]);
  });

  it('nothing locks the screen orientation (WCAG 1.3.4)', () => {
    expect(offenders(/orientation\s*\.\s*lock|@media[^{]*orientation/)).toEqual([]);
  });

  it('nothing acts on pointer or mouse down, so a press can be cancelled (WCAG 2.5.2)', () => {
    expect(offenders(/onpointerdown|onmousedown|ontouchstart/)).toEqual([]);
  });
});

describe('reduced motion (WCAG 2.3.3)', () => {
  const ANIMATED = /(^|[^-])(animation|transition)\s*:/;
  // WP-701: judged per quoted class string, so one paired token cannot cover an unpaired one.
  const CLASS_STRING = /(['"`])((?:(?!\1)[^\n])*?\banimate-(?!none)[^\n]*?)\1/g;
  /** Class strings (or markup attribute values) whose animate-* tokens lack a reduced-motion answer. */
  const unpaired = (src: string): string[] =>
    [...src.matchAll(CLASS_STRING)].flatMap((m) => {
      const tokens = (m[2] ?? '').split(/\s+/);
      return tokens.filter((t) => {
        if (!/(^|:)animate-(?!none)[\w-]+$/.test(t) || t.startsWith('motion-safe:')) return false;
        const variant = /^(data-\[[^\]]+\]):animate-/.exec(t)?.[1];
        if (variant === undefined) return !tokens.some((x) => x.startsWith('motion-reduce:'));
        return !tokens.some(
          (x) => x === 'motion-reduce:animate-none!' || x.startsWith(`motion-reduce:${variant}`),
        );
      });
    });
  // WP-701: the participant app shares the one guard.
  const PARTICIPANT = join(process.cwd(), 'apps/web/src/lib/participant');
  const scanned = [...svelteFiles(SRC), ...svelteFiles(PARTICIPANT)];
  it('every component that animates or transitions has a prefers-reduced-motion rule', () => {
    const offenders = scanned.filter((f) => {
      const src = readFileSync(f, 'utf8');
      const rule = src.includes('prefers-reduced-motion');
      return (ANIMATED.test(src) && !rule) || (!rule && unpaired(src).length > 0);
    });
    expect(scanned.some((f) => f.includes('apps/web/src/lib/participant'))).toBe(true); // reaches the app
    expect(offenders.map((f) => relative(process.cwd(), f))).toEqual([]);
  });
  it('the guard judges each class string: an unpaired token in a file that pairs another is caught', () => {
    const cases: [string, string[]][] = [
      [`<a class="animate-spin motion-reduce:animate-none" /><b class="animate-pulse" />`, ['animate-pulse']],
      [`cn('data-[state=open]:animate-in motion-reduce:animate-none')`, ['data-[state=open]:animate-in']],
      [`cn('data-[state=open]:animate-in motion-reduce:animate-none!')`, []],
      [`cn('data-[state=open]:animate-in motion-reduce:data-[state=open]:animate-none')`, []],
      [`class="motion-safe:animate-spin"`, []],
      [`class="animate-none"`, []],
    ];
    for (const [src, bad] of cases) expect(unpaired(src), src).toEqual(bad);
  });
});
