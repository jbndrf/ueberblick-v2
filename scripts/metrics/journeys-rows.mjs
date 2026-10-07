// Report rows for the Qwen UI explorer (metrics/raw/journeys.jsonl, written by scripts/ui/journeys).
import { sum, fmtK } from './lib.mjs';

/** Table cells [metric, value]; empty without entries. */
export function journeysRows(entries) {
  if (!entries.length) return [];
  const count = (key, value) => entries.filter((e) => e[key] === value).length;
  const verdicts = {};
  for (const e of entries) verdicts[e.verdict] = (verdicts[e.verdict] ?? 0) + 1;
  const tok = (k) => fmtK(sum(entries.map((e) => e.tokens?.[k])));
  const judged = entries.filter((e) => e.accepted !== null && e.accepted !== undefined);
  const findings = sum(entries.map((e) => e.findings));
  return [
    ['journeys run', `${entries.length}`],
    [
      'verdicts',
      Object.entries(verdicts)
        .map(([k, n]) => `${k} ${n}`)
        .join(', '),
    ],
    ['candidates ready / unstable', `${count('candidate', 'ready')} / ${count('candidate', 'unstable')}`],
    [
      'actions / screenshots / model calls',
      `${sum(entries.map((e) => e.actions))} / ${sum(entries.map((e) => e.screenshots))} / ${sum(entries.map((e) => e.calls))}`,
    ],
    ['findings (high)', `${findings} (${sum(entries.map((e) => e.high))})`],
    [
      'findings accepted by a lead (precision)',
      judged.length
        ? `${sum(judged.map((e) => e.accepted))} of ${sum(judged.map((e) => e.findings))}`
        : 'not yet judged',
    ],
    ['local model tokens in / out / image', `${tok('in')} / ${tok('out')} / ${tok('image')}`],
    ['model time', `${Math.round(sum(entries.map((e) => e.ms)) / 1000)} s`],
  ];
}
