// Output of one journey: <journey>.md (verdict, findings, steps), <journey>.steps.json, a metrics line in
// journeys.jsonl and an ATTENTION.md entry for high findings.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { append, attention } from '../../metrics/lib.mjs';

export function stepsDoc(def, result) {
  return {
    journey: def.id,
    title: def.title,
    fixture: def.fixture,
    viewport: def.viewport,
    role: def.role,
    verdict: result.verdict,
    steps: result.steps,
    expectations: result.expectations,
  };
}

const describe = (s) =>
  `${s.n}. ${s.cmd}${s.locator ? ` ${JSON.stringify(s.locator)}` : ''}${s.args?.length ? ` ${JSON.stringify(s.args)}` : ''}`;

export function reportMarkdown(def, result, candidate) {
  const st = result.stats;
  return [
    `# Journey ${def.id}: ${def.title}`,
    `- verdict: **${result.verdict}**`,
    `- candidate: ${candidate.status}${candidate.detail ? ` (${candidate.detail})` : ''}`,
    `- model calls ${st.calls} · tokens in ${st.in} / out ${st.out} / image ${st.image} · model ${st.ms} ms · actions ${st.actions} · screenshots ${st.screenshots}`,
    `- docs: ${def.docs.join(', ')} · ia-map: ${def.iaMap}`,
    '',
    '## Findings',
    ...(result.findings.length
      ? result.findings.map((f) => `- [${f.severity}] ${f.text}`)
      : ['- none reported']),
    ...(result.notes.length ? ['', '## Notes', ...result.notes.map((n) => `- ${n}`)] : []),
    ...(result.shots.length
      ? ['', '## Screenshots', ...result.shots.map((p) => `- shots/${basename(p)}`)]
      : []),
    '',
    '## Recorded steps (from the action log)',
    ...result.steps.map(describe),
    '',
    '## Expectations',
    ...(result.expectations.length
      ? result.expectations.map((x) => `- after step ${x.after}: ${JSON.stringify(x.expect)}`)
      : ['- none']),
    '',
  ].join('\n');
}

/** Writes the files and the metrics line. `dir` is metrics/raw/journeys/<stamp>. */
export function writeOutputs({ def, result, candidate, dir, rawDir, now = new Date() }) {
  mkdirSync(join(dir, 'shots'), { recursive: true });
  for (const p of result.shots) if (p && existsSync(p)) copyFileSync(p, join(dir, 'shots', basename(p)));
  writeFileSync(join(dir, `${def.id}.md`), reportMarkdown(def, result, candidate));
  writeFileSync(join(dir, `${def.id}.steps.json`), `${JSON.stringify(stepsDoc(def, result), null, 2)}\n`);
  const st = result.stats;
  append(
    'journeys.jsonl',
    {
      journey: def.id,
      verdict: result.verdict.startsWith('blocked-at') ? 'blocked-at' : result.verdict,
      tokens: { in: st.in, out: st.out, image: st.image },
      ms: st.ms,
      calls: st.calls,
      actions: st.actions,
      screenshots: st.screenshots,
      candidate: candidate.status,
      findings: result.findings.length,
      high: result.findings.filter((f) => f.severity === 'high').length,
      accepted: null,
    },
    rawDir,
  );
  const high = result.findings.filter((f) => f.severity === 'high');
  if (high.length)
    attention(
      `journey ${def.id}: ${result.verdict}`,
      [...high.map((f) => f.text), `details: metrics/raw/journeys/${basename(dir)}/${def.id}.md`],
      rawDir,
      now,
    );
}
