/**
 * Structural references inside a config: which entity path is named from which path.
 * Expression strings are not parsed here; `compile()` type-checks those against the effective config,
 * where a hidden entity is simply missing.
 */
import type { KeyPath } from './contract';
import { isObj, type Obj } from './paths';

export type References = Map<KeyPath, KeyPath[]>;

const entries = (v: unknown): [string, Obj][] =>
  isObj(v) ? Object.entries(v).filter((e): e is [string, Obj] => isObj(e[1])) : [];

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Keys of a keyed map (role app `views`, `tools`, `shortcuts`; A-005 item 1). */
const keysOf = (v: unknown): string[] => (isObj(v) ? Object.keys(v) : []);

/** Map each referenced entity path to the paths that refer to it. */
export function collectReferences(file: Obj): References {
  const refs: References = new Map();
  const add = (target: KeyPath, from: KeyPath) => {
    const list = refs.get(target);
    if (list) list.push(from);
    else refs.set(target, [from]);
  };
  const audience = (v: unknown, from: KeyPath) => {
    for (const role of Array.isArray(v) ? strings(v) : []) add(`roles.${role}`, from);
  };

  for (const [tk, task] of entries(file.tasks)) {
    const on = strings(task.on);
    for (const t of on) add(`types.${t}`, `tasks.${tk}.on`);
    for (const [fk, field] of entries(task.form)) {
      // `<bind>.<property>` addresses a bound type, not the task's: no reference to a subject property.
      if (!fk.includes('.')) for (const t of on) add(`types.${t}.properties.${fk}`, `tasks.${tk}.form.${fk}`);
      for (const tool of strings(field.tool)) add(`tools.${tool}`, `tasks.${tk}.form.${fk}.tool`);
    }
  }
  for (const [tk, task] of entries(file.tasks)) {
    for (const [ak, entry] of entries(task.auto)) {
      for (const t of strings(entry.after)) add(`tasks.${t}`, `tasks.${tk}.auto.${ak}.after`);
    }
  }
  for (const [vk, view] of entries(file.views)) {
    const type = isObj(view.source) ? strings(view.source.type)[0] : undefined;
    if (type) {
      add(`types.${type}`, `views.${vk}.source.type`);
      for (const p of strings(view.properties))
        add(`types.${type}.properties.${p}`, `views.${vk}.properties`);
      for (const s of strings(view.sort))
        add(`types.${type}.properties.${s.replace(/^-/, '')}`, `views.${vk}.sort`);
    }
    for (const [lk, layer] of entries(view.layers)) {
      const lt = isObj(layer.source) ? strings(layer.source.type)[0] : undefined;
      if (lt) add(`types.${lt}`, `views.${vk}.layers.${lk}.source.type`);
    }
  }
  for (const [rk, role] of entries(file.roles)) {
    const app = isObj(role.app) ? role.app : {};
    const at = `roles.${rk}.app`;
    for (const v of strings(app.home)) add(`views.${v}`, `${at}.home`);
    for (const v of keysOf(app.views)) add(`views.${v}`, `${at}.views`);
    for (const v of keysOf(app.tools)) add(`tools.${v}`, `${at}.tools`);
    for (const v of keysOf(app.shortcuts)) add(`tasks.${v}`, `${at}.shortcuts`);
  }
  for (const [tk, type] of entries(file.types)) {
    for (const [pk, prop] of entries(type.properties)) {
      for (const t of strings(prop.to)) add(`types.${t}`, `types.${tk}.properties.${pk}.to`);
    }
    for (const [rk, rel] of entries(type.relations)) {
      for (const t of strings(rel.to)) add(`types.${t}`, `types.${tk}.relations.${rk}.to`);
    }
    const perm = isObj(type.permissions) ? type.permissions : {};
    for (const k of ['see', 'create', 'delete'] as const) audience(perm[k], `types.${tk}.permissions.${k}`);
    if (isObj(perm.write)) {
      for (const [pk, aud] of Object.entries(perm.write)) {
        add(`types.${tk}.properties.${pk}`, `types.${tk}.permissions.write.${pk}`);
        audience(aud, `types.${tk}.permissions.write.${pk}`);
      }
    } else audience(perm.write, `types.${tk}.permissions.write`);
  }
  return refs;
}
