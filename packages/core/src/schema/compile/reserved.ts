/** Reserved words (RESERVED_KEYS) may not be used as keys: they share the namespace of expressions. */
import { RESERVED_KEYS } from '../../registry/compile';
import type { TemplateFile } from '../file';
import { kp } from './kp';
import type { Sink } from './problems';

const isReserved = (k: string): boolean => (RESERVED_KEYS.keys as readonly string[]).includes(k);

export function checkReservedKeys(file: TemplateFile, sink: Sink): void {
  const check = (path: readonly string[], keys: Iterable<string>): void => {
    for (const k of keys) {
      if (!isReserved(k)) continue;
      sink.error(
        kp(...path, k),
        'reserved_key',
        `'${k}' is a reserved word and cannot be used as a key`,
        `rename the key to something else, e.g. '${k}_1' or a descriptive name; reserved: ${RESERVED_KEYS.keys.join(', ')}`,
        { key: k, reserved: RESERVED_KEYS.keys.join(', ') },
      );
    }
  };
  const map = (path: readonly string[], m: object | undefined): void => check(path, Object.keys(m ?? {}));
  for (const section of ['roles', 'types', 'tasks', 'views', 'tools', 'inputs'] as const) {
    map([section], file[section]);
  }
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    map(['types', tk, 'properties'], type.properties);
    map(['types', tk, 'relations'], type.relations);
    for (const [pk, p] of Object.entries(type.properties))
      map(['types', tk, 'properties', pk, 'options'], p.options);
  }
  for (const [key, p] of Object.entries(file.inputs ?? {})) map(['inputs', key, 'options'], p.options);
  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    map(['tasks', key, 'bind'], task.bind);
    map(['tasks', key, 'auto'], task.auto);
  }
  for (const [key, view] of Object.entries(file.views ?? {})) map(['views', key, 'layers'], view.layers);
}
