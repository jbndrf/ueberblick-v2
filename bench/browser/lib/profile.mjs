// Pure helpers over a CDP CPU profile (used by attribute.mjs and the spec).

/** Script key of a call frame: MapLibre files collapse into one; native frames keep their function name. */
export function scriptOf(callFrame) {
  if (callFrame.url === '') return callFrame.functionName;
  return callFrame.url.includes('maplibre') ? 'maplibre' : callFrame.url.split('/').pop();
}

/** Inclusive busy time in ms per script over the whole profile (a script counts once per sample). */
export function byScript(prof) {
  const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const totals = new Map();
  prof.samples.forEach((id, i) => {
    const seen = new Set();
    for (let k = id; k !== undefined; k = parent.get(k)) {
      const key = scriptOf(nodes.get(k).callFrame);
      if (seen.has(key)) continue;
      seen.add(key);
      totals.set(key, (totals.get(key) ?? 0) + prof.timeDeltas[i] / 1000);
    }
  });
  return totals;
}
