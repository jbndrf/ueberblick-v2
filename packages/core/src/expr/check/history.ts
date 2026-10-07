/** The history functions (`last`, `changed`, `count`, `changed_at`) of the rule language (docs/06). */
import type { CallNode } from '../ast';
import type { Checker } from './check';
import { DEVICE_HISTORY_LIMIT } from './functions';
import { T, closest, listOf, own } from './ty';
import type { Ty } from './types';

export function checkHistory(h: Checker, e: CallNode): Ty {
  const [prop, n] = e.args;
  const want = e.name === 'last' ? 2 : 1;
  if (e.args.length !== want)
    return h.err('history_arity', `${e.name}() takes ${want} argument${want === 1 ? '' : 's'}`, e.span, {
      name: e.name,
      count: want,
    });
  const self = own(h.env.vars, 'self');
  if (!self)
    return h.err('history_needs_self', `${e.name}() needs 'self' in scope`, e.span, { name: e.name });
  if (prop?.kind !== 'literal' || prop.type !== 'string') {
    return h.err(
      'history_property_literal',
      `the first argument of ${e.name}() is a property name in quotes`,
      (prop ?? e).span,
      { name: e.name },
      [`e.g. ${e.name}('stage')`, 'default'],
    );
  }
  const fields = h.fieldsOf(self, e.span);
  const pt = fields?.[prop.value as string];
  if (!pt) {
    const near = closest(prop.value as string, Object.keys(fields ?? {}));
    const available = Object.keys(fields ?? {}).join(', ');
    const owner = self.kind === 'feature' ? `'${self.type}'` : 'self';
    return h.err(
      'unknown_property',
      `unknown property '${String(prop.value)}'`,
      prop.span,
      {
        property: String(prop.value),
        ...(self.kind === 'feature' ? { type: self.type } : {}),
        ...(near ? { near } : { available }),
      },
      near
        ? [`did you mean '${near}'?`, 'near']
        : [
            `properties of ${owner}: ${available || '(none)'}`,
            available === '' ? 'none' : self.kind === 'feature' ? 'available_on_type' : 'available_on_self',
          ],
    );
  }
  if (n) {
    const nt = h.types.get(n) ?? T.dyn;
    h.expectTy(nt, T.int, n.span, 'the count', 'count_type');
    if (n.kind === 'literal' && n.type === 'int') {
      if ((n.value as number) < 1) h.err('count_minimum', 'the count must be at least 1', n.span);
      else if (h.env.device && (n.value as number) > DEVICE_HISTORY_LIMIT) {
        h.err(
          'device_history_limit',
          `the device keeps only the last ${DEVICE_HISTORY_LIMIT} values per property`,
          n.span,
          { limit: DEVICE_HISTORY_LIMIT },
          [`use ${DEVICE_HISTORY_LIMIT} or less, or evaluate this on the server`, 'default'],
        );
      }
    } else if (h.env.device) {
      h.err('device_count_literal', 'on the device the count must be a literal number', n.span);
    }
  }
  if (e.name === 'last') return listOf(pt);
  if (e.name === 'changed') return T.bool;
  if (e.name === 'count') return T.int;
  if (e.name === 'changed_at') return T.timestamp;
  return pt;
}
