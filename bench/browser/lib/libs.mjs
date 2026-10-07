// System libraries for Playwright's headless Chromium. Some sandboxes lack them (docs/research/spike-3d.md).
// The setup downloads the Debian packages (no root: `apt-get download`), unpacks them into
// bench/browser/.libs and points LD_LIBRARY_PATH there. Nothing is skipped silently.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LIBS_DIR = join(HERE, '..', '.libs');
export const LIB_PATH = join(LIBS_DIR, 'usr', 'lib', 'x86_64-linux-gnu');

/** Library (soname stem) to Debian package. Extend when `ldd` names a library that is not here. */
const PACKAGE_BY_LIB = {
  libnspr4: 'libnspr4',
  libnss3: 'libnss3',
  libnssutil3: 'libnss3',
  libsmime3: 'libnss3',
  libatk: 'libatk1.0-0',
  'libatk-1.0': 'libatk1.0-0',
  'libatk-bridge-2.0': 'libatk-bridge2.0-0',
  libatspi: 'libatspi2.0-0',
  libXdamage: 'libxdamage1',
  libxkbcommon: 'libxkbcommon0',
  libasound: 'libasound2',
  libXcomposite: 'libxcomposite1',
  libXfixes: 'libxfixes3',
  libXrandr: 'libxrandr2',
  libXext: 'libxext6',
  libgbm: 'libgbm1',
  libcups: 'libcups2',
  libdrm: 'libdrm2',
  libpango: 'libpango-1.0-0',
  libcairo: 'libcairo2',
};

/** Sonames that `ldd` reports as "not found". */
export function missingLibs(lddOutput) {
  return lddOutput
    .split('\n')
    .filter((l) => l.includes('=> not found'))
    .map((l) => l.trim().split(/\s+/)[0]);
}

/** Debian package names (unique, in order) for missing sonames. An unknown library throws. */
export function debPackagesFor(sonames) {
  const out = [];
  for (const so of sonames) {
    const stem = so.replace(/\.so(\..*)?$/, '');
    const pkg = PACKAGE_BY_LIB[stem];
    if (pkg === undefined) {
      throw new Error(`No Debian package known for ${so}: add it to bench/browser/lib/libs.mjs`);
    }
    if (!out.includes(pkg)) out.push(pkg);
  }
  return out;
}

function ldd(exe, extraPath) {
  try {
    const env = { ...process.env };
    if (extraPath !== undefined && existsSync(extraPath)) env.LD_LIBRARY_PATH = extraPath;
    return execFileSync('ldd', [exe], { encoding: 'utf8', env });
  } catch (e) {
    throw new Error(`ldd failed on ${exe}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

/**
 * Makes `exe` loadable. Returns the environment to launch it with. Idempotent: when nothing is missing
 * it changes nothing, and packages already unpacked are reused.
 */
export function ensureLibs(exe) {
  let missing = missingLibs(ldd(exe, LIB_PATH));
  for (let round = 0; missing.length > 0 && round < 3; round++) {
    const packages = debPackagesFor(missing);
    console.log(`browser setup: fetching ${packages.join(', ')} into ${LIBS_DIR}`);
    const tmp = join(LIBS_DIR, 'debs');
    mkdirSync(tmp, { recursive: true });
    execFileSync('apt-get', ['download', ...packages], { cwd: tmp, stdio: 'inherit' });
    for (const deb of readdirSync(tmp).filter((f) => f.endsWith('.deb'))) {
      execFileSync('dpkg', ['-x', join(tmp, deb), LIBS_DIR], { stdio: 'inherit' });
    }
    missing = missingLibs(ldd(exe, LIB_PATH));
  }
  if (missing.length > 0) {
    throw new Error(`Chromium still misses ${missing.join(', ')} after the scripted setup`);
  }
  return existsSync(LIB_PATH) ? { LD_LIBRARY_PATH: LIB_PATH } : {};
}
