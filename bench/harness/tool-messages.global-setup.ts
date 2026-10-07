import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Compiles the Paraglide messages of every tool plug-in that has none yet (they are generated, not committed),
 * so `npm run bench` works in a fresh worktree. Same mechanism as packages/ui/vitest.global-setup.ts. */
export default function setup(): void {
  const root = join(process.cwd(), 'packages', 'tools');
  for (const tool of readdirSync(root)) {
    const dir = join(root, tool);
    if (!existsSync(join(dir, 'project.inlang')) || existsSync(join(dir, 'src', 'paraglide'))) continue;
    execFileSync('npx', ['paraglide-js', 'compile', '--project', './project.inlang', '--outdir', './src/paraglide'], {
      cwd: dir,
      stdio: 'ignore',
    });
  }
}
