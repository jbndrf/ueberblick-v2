/** `on: { when }` (A-045): a condition that becomes true through the clock alone is the `elapsed` trigger's job. */
import type { Expr } from '../../expr/ast';
import { children } from '../../expr/parse/walk';
import { autoPath, type Auto } from './autos';
import type { Sink } from './problems';

const readsTime = (e: Expr): boolean =>
  (e.kind === 'ident' && e.name === 'now') ||
  (e.kind === 'call' && e.name === 'today') ||
  children(e).some(readsTime);

/** Warns when the trigger expression reads `now` or `today()`: it is only evaluated after a run, never by the clock. */
export function checkWhenTrigger(sink: Sink, a: Auto, ast: Expr): void {
  if (!readsTime(ast)) return;
  sink.warn(
    autoPath(a, 'when'),
    'when_trigger_uses_time',
    'an automatic action without a timing is judged after a run, so a condition that turns true with the clock alone never fires',
    'use `elapsed: { from: … }` for time, and keep the edge `when` for properties',
    {},
  );
}
