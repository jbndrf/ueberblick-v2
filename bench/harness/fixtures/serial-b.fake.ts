// Fake bench for the serial-run test: records its start and end time, sleeping in between.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';

it('fake serial b', async () => {
  const start = Date.now();
  await new Promise((r) => setTimeout(r, 400));
  appendFileSync(process.env.BENCH_TIMES ?? '/dev/null', JSON.stringify({ file: 'b', start, end: Date.now() }) + '\n');
});
