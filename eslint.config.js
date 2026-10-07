// Guardrails (CLAUDE.md R2, R6, R8). Do not weaken without an accepted decision record.
import tseslint from 'typescript-eslint';

const CORE_BANNED_IMPORTS = {
  patterns: [
    {
      group: ['node:*', 'fs', 'path', 'os', 'crypto', 'child_process'],
      message: 'packages/core does no I/O (R2). Use ports.',
    },
    {
      group: ['better-sqlite3', 'sqlite*', 'idb', 'svelte', 'svelte/*', '@sveltejs/*', 'maplibre-gl'],
      message: 'packages/core is pure (R2).',
    },
    {
      group: ['@ueberblick/server', '@ueberblick/client', '@ueberblick/ui', '@ueberblick/builder'],
      message: 'core depends on nothing (docs/03).',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      'reference/**',
      '.claude/**',
      'packages/ui/src/paraglide/**',
      'packages/builder/src/paraglide/**',
      'packages/tools/*/src/paraglide/**',
      'apps/web/src/lib/participant/paraglide/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.svelte-kit/**',
      '**/.svelte-check/**',
      'docs/**',
      'fixtures/**',
      'spikes/**',
      'schema/**',
      '.githooks/**',
      // Plants (scripts/testing/plant.mjs) come and go while specs run; a whole-repo eslint reads a file mid-delete (ENOENT).
      '**/*.planted*',
      '**/*.planted/',
    ],
  },
  ...tseslint.configs.strict,
  {
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSTypeAliasDeclaration > TSUnionType:has(TSLiteralType ~ TSLiteralType ~ TSLiteralType)',
          message:
            'Domain enums live in packages/core/src/registry (R6). Derive the type from the registry array.',
        },
      ],
    },
  },
  {
    files: ['packages/core/src/registry/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['packages/core/**/*.ts'],
    ignores: ['packages/core/src/testing/**', '**/*.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', CORE_BANNED_IMPORTS],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Inject time via the Clock port (R2).' },
        { object: 'Math', property: 'random', message: 'Inject randomness via ports (R2).' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'No I/O in core (R2).' },
        { name: 'window', message: 'No DOM in core (R2).' },
        { name: 'document', message: 'No DOM in core (R2).' },
        { name: 'localStorage', message: 'No I/O in core (R2).' },
        { name: 'indexedDB', message: 'No I/O in core (R2).' },
      ],
    },
  },
  {
    // WP-537: server code logs only through packages/server/src/log (docs/process/logging.md).
    files: ['packages/server/**/*.{ts,mjs,js}'],
    ignores: ['packages/server/src/log/**', '**/*.spec.ts'],
    rules: {
      'no-restricted-globals': ['error', { name: 'console', message: 'use packages/server/src/log' }],
      'no-restricted-properties': [
        'error',
        ...['globalThis', 'global', 'self'].map((object) => ({
          object,
          property: 'console',
          message: 'use packages/server/src/log',
        })),
      ],
    },
  },
  {
    // WP-1003: the @lucide/svelte root barrel costs ~10 s cold per worker. Svelte files are not linted here;
    // scripts/ops/lucide-imports.spec.ts guards them too.
    files: ['packages/**/*.ts', 'apps/**/*.ts'],
    ignores: ['packages/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@lucide/svelte',
              allowTypeImports: true,
              message: "WP-1003: import icons one by one: import X from '@lucide/svelte/icons/<kebab-name>'.",
            },
          ],
        },
      ],
    },
  },
  {
    // WP-1018: `participant/messages` pulls the whole Paraglide barrel (~1800 modules, ~6 s cold per worker). Server-only
    // graphs read a tag through `participant/locale-tag` and import the Locale type only. Allowlist (add a file to
    // `ignores` WITH a reason): none today. routes/join/** renders participant messages server-side through
    // `participant/server-messages` (WP-1021: per-message imports, no barrel). Repeats the lucide path because a later `no-restricted-imports` replaces the block above.
    files: [
      'apps/web/src/lib/server/**/*.ts',
      'apps/web/src/routes/**/*.server.ts',
      'apps/web/src/routes/**/+server.ts',
      'apps/web/src/routes/join/**/*.ts',
    ],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@lucide/svelte',
              allowTypeImports: true,
              message: "WP-1003: import icons one by one: import X from '@lucide/svelte/icons/<kebab-name>'.",
            },
          ],
          patterns: [
            {
              group: ['**/participant/messages'],
              allowTypeImports: true,
              message:
                'WP-1018: participant/messages loads the whole Paraglide barrel. Use participant/locale-tag for localeOf; import only types.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.js', '*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
