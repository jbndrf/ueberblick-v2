// WP-1035: a repeat run holds a shared e2e slot for minutes. Over 10 repeats it is a lead's call (UEB_E2E_REPEAT_OK=1).
const LINE =
  'e2e: --repeat-each N is over 10; a repeat run holds a shared e2e slot. Ask your lead, then rerun with UEB_E2E_REPEAT_OK=1';

/** The refusal line for `--repeat-each N` / `--repeat-each=N` with N over 10, or null. */
export function repeatCapError(argv, env = process.env) {
  if (env.UEB_E2E_REPEAT_OK === '1') return null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = a === '--repeat-each' ? argv[i + 1] : a.startsWith('--repeat-each=') ? a.slice(14) : undefined;
    if (v !== undefined && Number(v) > 10) return LINE;
  }
  return null;
}

/** Prints the refusal and exits 64 when the cap is hit (checked before anything starts, so no gate slot is taken). */
export function enforceRepeatCap(argv, env = process.env) {
  const line = repeatCapError(argv, env);
  if (line) {
    console.error(line);
    process.exit(64);
  }
}
