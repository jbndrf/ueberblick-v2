/** The commands of `npm run migrate`; each is one step of `docs/process/cutover-runbook.md`. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { convertConfig } from './config';
import { diffcheck, formatReport, parseRuns, summarize } from './diffcheck';
import { migrationStore, readDataExport, runMigration } from './data';
import { dryRun, dryRunFixture, formatDryRun } from './dry-run';

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export const USAGE = `usage: npm run migrate -w @ueberblick/migrate -- <command>
  convert <v3-project.yaml> --out <dir>            template.yaml, overlay.yaml, report.json, mapping.json
  diffcheck <v3-project.yaml> <v3-runs.yaml>       replay recorded v3 runs; exit 1 when a difference is unexplained
  import <v3-project.yaml> <v3-data.yaml> --dir <dir> [--key <key>]
                                                   run the data migration into <dir>/project-<key>.db
  dry-run [fixture]                                the whole chain on a synthetic fixture (default baumkontrolle)`;

const read = (path: string): unknown => parse(readFileSync(path, 'utf8')) as unknown;

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
}

/** The positional arguments: everything that is neither `--name` nor its value. */
function positional(args: string[]): string[] {
  return args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]?.startsWith('--')));
}

function summaryLine(c: ReturnType<typeof convertConfig>): string {
  const s = c.report.summary;
  return `${s.total} items: ${s.mapped} mapped, ${s.approximated} approximated, ${s.dropped} dropped; converted project ${c.check.ok ? 'compiles' : 'DOES NOT compile'}`;
}

/** Returns the exit code: 0 done, 1 the check found a problem, 2 wrong use. */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  const files = positional(args);
  try {
    if (command === 'convert' && files[0] !== undefined) {
      const out = option(args, 'out');
      if (out === undefined) return usage(io);
      const c = convertConfig(read(files[0]) as never);
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'template.yaml'), stringify(c.template));
      writeFileSync(join(out, 'overlay.yaml'), stringify(c.overlay));
      writeFileSync(join(out, 'report.json'), JSON.stringify(c.report, null, 2));
      writeFileSync(join(out, 'mapping.json'), JSON.stringify(c.mapping, null, 2));
      io.out(summaryLine(c));
      for (const m of c.personal) io.out(`personal data: ${m.target} (${m.reason})`);
      return c.check.ok && c.report.stray.length === 0 ? 0 : 1;
    }
    if (command === 'diffcheck' && files.length === 2) {
      const converted = convertConfig(read(files[0] as string) as never);
      const runs = parseRuns(read(files[1] as string));
      const summary = summarize(runs.length, diffcheck(runs, converted));
      io.out(formatReport(summary));
      return summary.unexplained === 0 ? 0 : 1;
    }
    if (command === 'import' && files.length === 2) {
      const dir = option(args, 'dir');
      if (dir === undefined) return usage(io);
      const { openProjectDb } = await import('@ueberblick/server');
      const converted = convertConfig(read(files[0] as string) as never, { target: 'import' });
      const target = converted.target;
      if (target === undefined) throw new Error('the converted project does not compile; run convert first');
      const db = openProjectDb(dir, option(args, 'key') ?? 'migrated');
      try {
        const clock = { now: () => new Date().toISOString() };
        const { store, geo, configVersion } = migrationStore(db, target, clock);
        const data = readDataExport(read(files[1] as string));
        const r = await runMigration(store, data, converted.mapping, {
          target,
          geo,
          configVersion,
          roster: db,
        });
        io.out(`${r.accepted} runs accepted in ${r.batches} batches, ${r.problems.length} problems`);
        for (const p of r.problems) io.out(`  ${p.code} ${p.record}: ${p.message}`);
        return r.problems.some((p) => p.code === 'refused') ? 1 : 0;
      } finally {
        db.close();
      }
    }
    if (command === 'dry-run') {
      const result = await dryRun(dryRunFixture(files[0] ?? 'baumkontrolle'));
      io.out(formatDryRun(result));
      return result.ok ? 0 : 1;
    }
  } catch (e) {
    io.err(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return 1;
  }
  return usage(io);
}

function usage(io: CliIo): number {
  io.err(USAGE);
  return 2;
}
