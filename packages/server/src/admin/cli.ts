/** Entry point of `npm run admin`. */
import { runCli } from './cli-run';

process.exitCode = await runCli(process.argv.slice(2), process.env, {
  out: (l) => process.stdout.write(l + '\n'),
  err: (l) => process.stderr.write(l + '\n'),
});
