// CycloneDX 1.5 SBOM generator. Reads the production dependency tree (workspaces included, dev
// dependencies excluded) from `npm ls` and writes dist/sbom.cdx.json. Run: npm run sbom.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Package URL for an npm package, scope '@' percent-encoded per the purl spec. */
export function purl(name, version) {
  return `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;
}

/** Best-effort licence entry from an installed package.json; empty when unknown. */
function licensesOf(name, root) {
  const file = join(root, 'node_modules', name, 'package.json');
  if (!existsSync(file)) return [];
  const { license } = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof license !== 'string' || license === '') return [];
  return /\s|\(|\)/.test(license) ? [{ expression: license }] : [{ license: { id: license } }];
}

/**
 * Pure: turns the JSON of `npm ls --all --omit=dev --json` into a CycloneDX 1.5 document.
 * `licensesFor(name)`, `now` and `serial` are injected so tests stay deterministic.
 */
export function buildSbom(tree, { licensesFor = () => [], now = new Date(), serial = randomUUID() } = {}) {
  const components = new Map();
  const edges = new Map();
  const refOf = (name, node) =>
    String(node.resolved ?? '').startsWith('file:') ? `${name}@${node.version}` : purl(name, node.version);

  const walk = (name, node) => {
    const ref = refOf(name, node);
    if (!components.has(ref)) {
      const licenses = licensesFor(name);
      components.set(ref, {
        type: 'library',
        'bom-ref': ref,
        name,
        version: node.version,
        ...(ref.startsWith('pkg:') ? { purl: ref } : {}),
        ...(licenses.length > 0 ? { licenses } : {}),
      });
    }
    const children = new Set(edges.get(ref) ?? []);
    for (const [childName, child] of Object.entries(node.dependencies ?? {})) {
      if (typeof child.version !== 'string' || child.extraneous) continue;
      children.add(refOf(childName, child));
      walk(childName, child);
    }
    edges.set(ref, children);
  };

  const rootRef = `${tree.name}@${tree.version}`;
  const rootChildren = new Set();
  for (const [name, node] of Object.entries(tree.dependencies ?? {})) {
    // Extraneous packages sit in node_modules but not in the lockfile; they are not shipped.
    if (typeof node.version !== 'string' || node.extraneous) continue;
    rootChildren.add(refOf(name, node));
    walk(name, node);
  }

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${serial}`,
    version: 1,
    metadata: {
      timestamp: now.toISOString(),
      tools: { components: [{ type: 'application', name: 'ueberblick-sbom', version: '1' }] },
      component: { type: 'application', 'bom-ref': rootRef, name: tree.name, version: tree.version },
    },
    components: [...components.values()],
    dependencies: [
      { ref: rootRef, dependsOn: [...rootChildren] },
      ...[...edges].map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn] })),
    ],
  };
}

const isTree = (v) =>
  v !== null && typeof v === 'object' && typeof v.name === 'string' && typeof v.version === 'string';

function runNpmLs(root) {
  return execFileSync('npm', ['ls', '--all', '--omit=dev', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Runs `npm ls` (injectable as `run` for tests). npm exits non-zero on tree problems (extraneous,
 * missing) but still prints the tree; that is accepted only when stdout parses to a tree.
 * Anything else rethrows with the exit status and captured stderr.
 */
export function readTree(root = ROOT, run = runNpmLs) {
  try {
    return JSON.parse(run(root));
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout !== '') {
      try {
        const tree = JSON.parse(error.stdout);
        if (isTree(tree)) return tree;
      } catch {
        // fall through to the rethrow below
      }
    }
    throw new Error(
      `npm ls failed (status ${error.status ?? 'unknown'}): ${String(error.stderr ?? error.message)}`,
    );
  }
}

export function generate(root = ROOT) {
  const sbom = buildSbom(readTree(root), { licensesFor: (name) => licensesOf(name, root) });
  const file = join(root, 'dist', 'sbom.cdx.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(sbom, null, 2)}\n`);
  return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`wrote ${generate()}`);
}
