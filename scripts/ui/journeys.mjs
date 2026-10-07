#!/usr/bin/env node
// npm run journeys [-- --journey <id> | --all | --list] [--no-candidate]
// The local model explores a journey through ui.mjs, the recorded steps become a Playwright candidate
// (docs/process/journeys.md part C). Needs the built web app: npm run build -w @ueberblick/web.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat, gpuFree } from '../local-model.mjs';
import { waitForGpu } from '../e2e-triage/lib.mjs';
import { rawDir } from '../metrics/lib.mjs';
import { CANDIDATE, makeCandidate } from './journeys/candidate.mjs';
import { JOURNEYS, journeyById } from './journeys/defs.mjs';
import { writeOutputs, stepsDoc } from './journeys/output.mjs';
import { runJourney } from './journeys/runner.mjs';
import { ensureBuilt } from '../ops/web-build.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const UI = fileURLToPath(new URL('./ui.mjs', import.meta.url));
const has = (f) => process.argv.includes(f);
const arg = (f) => (has(f) ? process.argv[process.argv.indexOf(f) + 1] : undefined);

if (has('--list')) {
  for (const j of JOURNEYS) console.log(`${j.id.padEnd(18)} ${j.title}`);
  process.exit(0);
}
const wanted = has('--all') ? JOURNEYS : [journeyById(arg('--journey') ?? '')].filter(Boolean);
if (wanted.length === 0) {
  console.error(
    `usage: npm run journeys -- --journey <id> | --all | --list   (ids: ${JOURNEYS.map((j) => j.id).join(', ')})`,
  );
  process.exit(2);
}
await ensureBuilt();
if (has('--all') && !(await waitForGpu({ gpuFree: () => gpuFree().catch(() => true) }, 120_000))) {
  console.error(
    'journeys: the GPU served another model for 2 minutes; run again in the quiet hours (or use --journey)',
  );
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(rawDir(), 'journeys', stamp);
mkdirSync(outDir, { recursive: true });

/** One ui.mjs call as its own process, against a session of its own (UI_STATE_DIR) so nothing else is disturbed. */
function makeUi(env) {
  return (cmd, args, flags) =>
    new Promise((resolve) => {
      const flagArgs = Object.entries(flags ?? {}).flatMap(([k, v]) => [
        `--${k}`,
        ...(v === true ? [] : [String(v)]),
      ]);
      execFile(
        process.execPath,
        [UI, cmd, ...args, ...flagArgs, '--json'],
        { env, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout) => {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve({ ok: false, error: err ? String(err.message).split('\n')[0] : 'no output' });
          }
        },
      );
    });
}

let worst = 0;
for (const def of wanted) {
  const state = mkdtempSync(join(tmpdir(), 'ueberblick-journey-'));
  const runDir = join(state, 'run');
  mkdirSync(join(runDir, 'shots'), { recursive: true });
  const env = { ...process.env, UI_STATE_DIR: state, UI_RUN_DIR: runDir };
  const ui = makeUi(env);
  try {
    const docsText = def.docs
      .map((d) => readFileSync(join(ROOT, d), 'utf8'))
      .join('\n')
      .slice(0, 9000);
    const result = await runJourney({
      def,
      docsText,
      model: { chat },
      ui,
      readActions: () => {
        const f = join(runDir, 'actions.jsonl');
        return existsSync(f)
          ? readFileSync(f, 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((l) => JSON.parse(l))
          : [];
      },
      readShot: (p) => (p && existsSync(p) ? readFileSync(p) : null),
      now: Date.now,
    });
    let candidate = { status: CANDIDATE.NONE, file: null, detail: 'verdict is not passes' };
    if (result.verdict === 'passes' && !has('--no-candidate'))
      candidate = makeCandidate({ doc: stepsDoc(def, result) });
    writeOutputs({ def, result, candidate, dir: outDir, rawDir: rawDir() });
    console.log(
      `${def.id}: ${result.verdict} · candidate ${candidate.status}${candidate.detail ? ` (${candidate.detail})` : ''} · ${result.stats.calls} calls, ${result.stats.actions} actions · ${outDir}/${def.id}.md`,
    );
  } catch (e) {
    console.error(`${def.id}: error: ${e instanceof Error ? e.message : String(e)}`);
    worst = 1;
  } finally {
    await ui('stop', [], {});
    rmSync(state, { recursive: true, force: true });
  }
}
process.exit(worst);
