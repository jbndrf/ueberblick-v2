// Attributes long tasks to call stacks from a CDP CPU profile (WP-541 diagnostics).
// node bench/browser/lib/attribute.mjs <dir> [minMs]  prints, per long task over minMs, the hottest stacks.
// Profile and long tasks are aligned by the profile's end: the last sample is the end of the pan/zoom phase.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byScript as scriptTotals } from './profile.mjs';

const dir = process.argv[2];
const min = Number(process.argv[3] ?? 100);
for (const f of readdirSync(dir).filter((n) => n.endsWith('.cpuprofile'))) {
  const prof = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const { tasks, stoppedAt } = JSON.parse(
    readFileSync(join(dir, f.replace('.cpuprofile', '.tasks.json')), 'utf8'),
  );
  const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const stack = (id) => {
    const out = [];
    for (let i = id; i !== undefined; i = parent.get(i)) {
      const cf = nodes.get(i).callFrame;
      out.push(`${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`);
    }
    return out.reverse().slice(1);
  };
  let t = prof.startTime;
  const samples = prof.samples.map((id, i) => ({ id, t: (t += prof.timeDeltas[i]) }));
  const end = prof.endTime;
  const byScript = scriptTotals(prof);
  console.log(
    `\n${f} inclusive ms by script: ${[...byScript]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 40)
      .map(([k, v]) => `${k}=${v.toFixed(0)}`)
      .join(' ')}`,
  );
  console.log(`\n${f}: long tasks ${tasks.map((x) => Math.round(x.duration)).join(', ') || 'none'}`);
  for (const task of tasks.filter((x) => x.duration >= min)) {
    // page clock -> profile clock: stoppedAt is the page clock at Profiler.stop, prof.endTime the profile clock.
    const a = end - (stoppedAt - task.start) * 1000;
    const b = a + task.duration * 1000;
    const tally = new Map();
    for (const s of samples) {
      if (s.t < a || s.t > b) continue;
      const key = stack(s.id).slice(-6).join(' < ');
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const total = [...tally.values()].reduce((x, y) => x + y, 0);
    console.log(`  task ${Math.round(task.duration)} ms, ${total} samples`);
    for (const [k, v] of [...tally].sort((x, y) => y[1] - x[1]).slice(0, 8)) {
      console.log(`    ${v}  ${k.split(' < ').reverse().join(' < ')}`);
    }
  }
}
