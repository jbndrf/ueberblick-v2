/** Reference resolution: every key that names another entity of the file must exist. */
import { AUDIENCES } from '../../registry';
import type { TemplateFile } from '../file';
import type { Property } from '../property';
import { getAt } from '../../template/paths';
import { stepProperties } from '../steps-of';
import { taskTypes } from './indexes';
import { kp } from './kp';
import type { Sink } from './problems';

const keys = (o: object | undefined): string[] => Object.keys(o ?? {});
const isAudienceKeyword = (s: string): boolean => (AUDIENCES.keys as readonly string[]).includes(s);

export function checkReferences(file: TemplateFile, sink: Sink): void {
  const types = keys(file.types);
  const tasks = keys(file.tasks);
  const views = keys(file.views);
  const roles = keys(file.roles);

  for (const [tk, type] of Object.entries(file.types ?? {})) {
    for (const [pk, p] of Object.entries(type.properties)) {
      if (p.to !== undefined && !types.includes(p.to)) {
        sink.dangling(kp('types', tk, 'properties', pk, 'to'), 'feature_type', p.to, types);
      }
      if (p.display_property !== undefined && p.to !== undefined && types.includes(p.to)) {
        const known = keys(file.types?.[p.to]?.properties);
        if (!known.includes(p.display_property))
          sink.dangling(
            kp('types', tk, 'properties', pk, 'display_property'),
            'property_of',
            p.display_property,
            known,
            { of: p.to },
          );
      }
      checkDefault(kp('types', tk, 'properties', pk, 'default'), p, sink);
    }
    for (const [rk, r] of Object.entries(type.relations ?? {})) {
      if (!types.includes(r.to))
        sink.dangling(kp('types', tk, 'relations', rk, 'to'), 'feature_type', r.to, types);
    }
    checkPermissions(tk, type.permissions, keys(type.properties), roles, sink);
  }

  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const on = taskTypes(task);
    for (const t of on) {
      if (!types.includes(t)) sink.dangling(kp('tasks', key, 'on'), 'feature_type', t, types);
    }
    if (task.creates !== undefined && !types.includes(task.creates)) {
      sink.dangling(kp('tasks', key, 'creates'), 'feature_type', task.creates, types);
    }
    // With `creates`, the form fills the created feature; otherwise it fills the feature the task is on.
    const subjects = task.creates !== undefined ? [task.creates] : on;
    if (subjects.every((t) => types.includes(t))) {
      for (const sk of stepProperties(task)) {
        const missing = subjects.find((t) => file.types?.[t]?.properties[sk] === undefined);
        if (missing !== undefined) {
          sink.dangling(
            kp('tasks', key, 'steps'),
            'property_of',
            sk,
            keys(file.types?.[missing]?.properties),
            { of: missing },
          );
        }
      }
      for (const step of task.steps ?? []) {
        if (step.kind !== 'location') continue;
        const notGeometry = subjects.find((t) => {
          const p = file.types?.[t]?.properties[step.property];
          return p !== undefined && p.type !== 'geometry';
        });
        if (notGeometry !== undefined) {
          sink.error(
            kp('tasks', key, 'steps'),
            'task_step_property_invalid',
            `'${step.property}' of ${notGeometry} is not a geometry property, so a location step cannot edit it`,
            'name a geometry property of the task subject',
            { property: step.property, type: notGeometry, task: key },
          );
        }
      }
      for (const fk of Object.keys(task.form ?? {})) {
        if (fk.includes('.')) continue; // `<bind>.<property>`: checked against the bound type with the binds (exprs.ts)
        const missing = subjects.find((t) => file.types?.[t]?.properties[fk] === undefined);
        if (missing !== undefined) {
          sink.dangling(
            kp('tasks', key, 'form', fk),
            'property_of',
            fk,
            keys(file.types?.[missing]?.properties),
            { of: missing },
          );
        }
      }
    }
  }

  for (const [key, view] of Object.entries(file.views ?? {})) {
    const src = view.source.type;
    if (!types.includes(src)) sink.dangling(kp('views', key, 'source', 'type'), 'feature_type', src, types);
    const props = keys(file.types?.[src]?.properties);
    if (types.includes(src)) {
      const known = [...props, 'geometry'];
      for (const s of view.sort ?? []) {
        const name = s.startsWith('-') ? s.slice(1) : s;
        if (!known.includes(name))
          sink.dangling(kp('views', key, 'sort'), 'property_of', name, props, { of: src });
      }
      for (const p of view.properties ?? []) {
        if (!known.includes(p))
          sink.dangling(kp('views', key, 'properties'), 'property_of', p, props, { of: src });
      }
    }
    for (const [lk, layer] of Object.entries(view.layers ?? {})) {
      const t = layer.source !== undefined && 'type' in layer.source ? layer.source.type : undefined;
      if (t !== undefined && !types.includes(t)) {
        sink.dangling(kp('views', key, 'layers', lk, 'source', 'type'), 'feature_type', t, types);
      }
    }
  }

  for (const [key, role] of Object.entries(file.roles ?? {})) {
    const app = role.app;
    if (!app) continue;
    if (app.home !== undefined && !views.includes(app.home)) {
      sink.dangling(kp('roles', key, 'app', 'home'), 'view', app.home, views);
    }
    for (const v of Object.keys(app.views ?? {})) {
      if (!views.includes(v)) sink.dangling(kp('roles', key, 'app', 'views'), 'view', v, views);
    }
    for (const t of Object.keys(app.shortcuts ?? {})) {
      if (!tasks.includes(t)) sink.dangling(kp('roles', key, 'app', 'shortcuts'), 'task', t, tasks);
    }
  }

  for (const path of file.lock ?? []) {
    if (getAt(file, path) === undefined) {
      sink.error(
        'lock',
        'dangling_reference',
        `the locked path '${path}' does not exist in this file`,
        `remove '${path}' from lock, or restore the element it protects`,
        { variant: 'locked_path', value: path },
      );
    }
  }
}

function checkDefault(path: string, p: Property, sink: Sink): void {
  if (p.default === undefined || p.options === undefined) return;
  const options = Object.keys(p.options);
  const values = Array.isArray(p.default) ? p.default : [p.default];
  for (const v of values) {
    if (typeof v === 'string' && !options.includes(v)) sink.dangling(path, 'option', v, options);
  }
}

function checkPermissions(
  tk: string,
  perms: NonNullable<TemplateFile['types']>[string]['permissions'],
  props: readonly string[],
  roles: readonly string[],
  sink: Sink,
): void {
  if (!perms) return;
  const audience = (path: string, a: unknown): void => {
    if (typeof a === 'string' && isAudienceKeyword(a)) return;
    for (const r of Array.isArray(a) ? a : []) {
      if (typeof r === 'string' && !roles.includes(r)) sink.dangling(path, 'role', r, roles);
    }
  };
  for (const op of ['create', 'delete'] as const) audience(kp('types', tk, 'permissions', op), perms[op]);
  // `see` and `write` take one audience or a property-key-to-audience map.
  for (const op of ['see', 'write'] as const) {
    const a = perms[op];
    if (a && typeof a === 'object' && !Array.isArray(a)) {
      for (const [pk, audiences] of Object.entries(a)) {
        const path = kp('types', tk, 'permissions', op, pk);
        if (!props.includes(pk)) sink.dangling(path, 'property', pk, props);
        audience(path, audiences);
      }
    } else audience(kp('types', tk, 'permissions', op), a);
  }
}
