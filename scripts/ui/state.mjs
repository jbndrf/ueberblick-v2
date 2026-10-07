// Where the ui.mjs session keeps its state: one directory, one JSON file, one run directory per session.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function stateDir() {
  const dir =
    process.env.UI_STATE_DIR ??
    join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `ueberblick-ui-${process.getuid?.() ?? 'u'}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const sessionFile = () => join(stateDir(), 'session.json');

/** @returns {{ port: number, pid: number, runDir: string } | undefined} */
export function readSession() {
  try {
    return JSON.parse(readFileSync(sessionFile(), 'utf8'));
  } catch {
    return undefined;
  }
}

export function writeSession(session) {
  writeFileSync(sessionFile(), JSON.stringify(session));
}

export function clearSession() {
  rmSync(sessionFile(), { force: true });
}

/** A fresh run directory (UI_RUN_DIR overrides it, so a caller can collect the action log). */
export function newRunDir() {
  const dir =
    process.env.UI_RUN_DIR ?? join(stateDir(), 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(join(dir, 'shots'), { recursive: true });
  return dir;
}
