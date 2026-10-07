/** Entry point of `npm run migrate`. */
import { runCli } from './cli-run';

process.exitCode = await runCli(process.argv.slice(2), {
  out: (l) => process.stdout.write(l + '\n'),
  err: (l) => process.stderr.write(l + '\n'),
});
