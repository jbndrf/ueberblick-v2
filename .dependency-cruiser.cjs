const fs = require('node:fs');
const path = require('node:path');

/** Every file a workspace package publishes through its `exports` map: cross-package imports may land there. */
function publishedEntries() {
  const out = [];
  for (const dir of ['packages', 'packages/tools']) {
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const file = path.join(dir, name, 'package.json');
      if (!fs.existsSync(file)) continue;
      const exp = JSON.parse(fs.readFileSync(file, 'utf8')).exports ?? {};
      for (const target of typeof exp === 'string' ? [exp] : Object.values(exp)) {
        if (typeof target === 'string') out.push(path.posix.join(dir, name, target.replace(/^\.\//, '')));
      }
    }
  }
  return out;
}
// An `exports` pattern (`./components/ui/*`) matches one path segment at the `*`.
const ENTRIES = publishedEntries().map(
  (f) => `^${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^/]+')}$`,
);

/** Package dependency graph (docs/03-architecture.md). Violations fail `npm run check`. */
module.exports = {
  forbidden: [
    { name: 'no-reference', severity: 'error', from: {}, to: { path: '^reference/' } },
    {
      name: 'core-is-a-leaf',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^packages/(server|client|ui|builder|tools)/' },
    },
    {
      name: 'server-client-separate',
      severity: 'error',
      from: { path: '^packages/server/' },
      to: { path: '^packages/(client|ui|builder|tools)/' },
    },
    {
      name: 'client-server-separate',
      severity: 'error',
      from: { path: '^packages/client/' },
      to: { path: '^packages/(server|builder)/' },
    },
    {
      name: 'ui-no-server',
      severity: 'error',
      from: { path: '^packages/(ui|builder|tools)/' },
      to: { path: '^packages/server/' },
    },
    {
      name: 'participant-no-builder',
      severity: 'error',
      comment:
        'Builder code stays out of the participant bundle (WP-212): packages/ui, packages/client, packages/tools and every apps/web source outside the (builder) route group never import @ueberblick/builder or packages/builder, whether by package name, deep path, relative path or dynamic import().',
      from: {
        path: '^(packages/(ui|client|tools)/|apps/web/src/)',
        pathNot: [
          '^apps/web/src/routes/\\(builder\\)/',
          '^apps/web/src/routes/\\(admin\\)/',
          '^apps/web/src/lib/admin/draft/versions-client\\.ts$', // implements the builder's VersionsApi, used only by (builder) routes (WP-326)
          '^apps/web/src/routes/api/mcp/',
          '\\.(spec|test)\\.ts$',
        ],
      },
      to: { path: '(^packages/builder/|(^|/)@ueberblick/builder(/|$))' },
    },
    {
      name: 'participant-core-subpaths',
      severity: 'error',
      comment:
        'Participant code (client, ui) imports @ueberblick/core subpaths only, types included (WP-122.1, WP-129.2): the root barrel, /schema, /compile, /expr/compile and /template pull Zod, the checker or the parser into the shell, and a type-only import still couples the code to them. Take config types from @ueberblick/core/model.',
      from: { path: '^packages/(client|ui)/src/', pathNot: '\\.(spec|test|testing)\\.ts$' },
      to: { path: '^packages/core/src/(index|schema/|expr/compile|template/)' },
    },
    {
      name: 'no-testing-helpers-in-prod',
      severity: 'error',
      comment:
        'Test helpers (*.testing.ts, *.testkit.ts, fixtures.ts, testkit.ts, __fixtures__/, builder/src/testing) may import heavy core modules and the simulation harness (packages/core/src/testing, @ueberblick/core/testing); production code must not import them.',
      from: {
        pathNot:
          '\\.(spec|test|testing|testkit)\\.ts$|(^|/)(fixtures|testkit)\\.ts$|/__fixtures__(/|\\.ts$)|^packages/builder/src/testing/|^packages/core/src/testing/|^packages/ui/src/testing/|^fixtures/golden/runner/',
      },
      to: { path: '\\.testing\\.ts$|^packages/core/src/testing/|^packages/ui/src/testing/' },
    },
    {
      name: 'tools-no-ui-barrel',
      severity: 'error',
      comment:
        'A lazily loaded tool imports the tool API (@ueberblick/ui/tool-api), never the ui barrel, which would pull the design system into the tool chunk (R14, WP-553).',
      from: { path: '^packages/tools/', pathNot: '\\.(spec|test|testing)\\.ts$' },
      to: { path: '^packages/ui/src/index\\.ts$' },
    },
    {
      name: 'view-style-stays-light',
      severity: 'error',
      comment:
        'The @ueberblick/ui/view-style subpath (WP-570) reaches neither the ui barrel nor anything under map/maplibre/ except style-spec.ts (the only importer of the Style Spec; maplibre-gl sits behind the rest), directly or transitively: the builder imports it without the map bundle (R14).',
      from: { path: '^packages/ui/src/map/view-style\\.ts$' },
      to: {
        path: ['^packages/ui/src/index\\.ts$', '^packages/ui/src/map/maplibre/'],
        pathNot: 'style-spec\\.ts$',
        reachable: true,
      },
    },
    {
      name: 'runtime-no-checker',
      severity: 'error',
      comment:
        'The run-time halves of the expression language (SQL translation, function registry, perms) take no value import from the checker (expr/check/check, functions, chain-shapes): the participant shell reaches them and must not ship the checker (WP-579). Share a table by moving it next to the registry (functions/), not by importing the checker.',
      from: {
        path: '^packages/core/src/(expr/(sql|functions)/|perms/)',
        pathNot: '\\.(spec|test|testing|testkit)\\.ts$',
      },
      to: {
        path: '^packages/core/src/expr/check/(check|functions|chain-shapes)\\.ts$',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Type-only cycles are erased at build; only value cycles fail (needed since tsPreCompilationDeps sees type imports, WP-129.1).',
      from: {},
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
    {
      name: 'no-deep-cross-package',
      severity: 'error',
      comment: 'Import other packages via their entry (@ueberblick/<pkg>), never their internals.',
      from: { path: '^packages/([^/]+)/' },
      to: { path: '^packages/([^/]+)/src/.+', pathNot: ['^packages/$1/', ...ENTRIES] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    // Workspace packages resolve through their `exports` map (subpaths), so cross-package rules see real files.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.svelte', '.json'],
    },
    // .svelte-check: svelte-check --incremental writes and deletes its temp .svelte.ts files there while boundaries runs beside it (parallel check:changed, WP-1015).
    exclude: { path: '(node_modules|reference|dist|\\.svelte-check)' },
  },
};
