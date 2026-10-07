/**
 * Reads a v3 project definition (the key-based export, `format: 1`) into the neutral model.
 * This is the only file that knows v3 key names; the lines with v3 vocabulary carry the
 * glossary-lint marker on purpose. Malformed roots throw `V3ExportError`; unknown parts inside are
 * kept and end up in the report as dropped.
 */
import type {
  FormStep,
  Item,
  Placement,
  Rec,
  SrcEntity,
  SrcProject,
  SrcProp,
  SrcRule,
  SrcStage,
  SrcTab,
  SrcTable,
  SrcTag,
  SrcTask,
  SrcType,
} from './model';
import {
  K,
  V3ExportError,
  arr,
  isRec,
  num,
  readCond,
  readEffect,
  readTrigger,
  rec,
  str,
  unref,
} from './read-parts';

export { V3ExportError, isRec, unref };

function readPlacement(x: unknown): Placement {
  const p = rec(x);
  const prefill = rec(p['prefill']);
  const showIf = rec(p['conditional_logic'])['show_if'];
  const out: Placement = {
    prop: unref(p[K.propId]),
    required: p['required'] === true,
    placeholder: typeof p['placeholder'] === 'string' && p['placeholder'] !== '',
    prefill: {
      kind: str(prefill['kind']) ?? 'empty',
      ...(prefill['value'] !== undefined ? { value: String(prefill['value']) } : {}),
      ...(prefill['expression'] !== undefined ? { expression: String(prefill['expression']) } : {}),
    },
    forceDirty: p['force_dirty'] === true,
    related: isRec(p['related']),
    layout: ['page', 'row', 'column'].some((k) => p[k] !== undefined),
    ...(str(p['help_text']) ? { helpText: str(p['help_text']) as string } : {}),
    ...(showIf !== undefined && showIf !== null ? { showIf: readCond(showIf) } : {}),
  };
  return out;
}

function readTask(typeId: string, x: unknown, i: number): SrcTask {
  const t = rec(x);
  const key = str(t['key']) ?? `task_${i}`;
  const id = `${typeId}.tasks.${key}`;
  const act = rec(t['activation']);
  const triggered = act['mode'] === 'triggered';
  const steps = arr(t['tools']).map((s, si): Item<FormStep> => {
    const st = rec(s);
    const sid = `${id}.tools.${si}`;
    return {
      id: sid,
      v: {
        kind: str(st['kind']) ?? 'form',
        ...(str(st['mode']) ? { mode: str(st['mode']) as string } : {}),
        hasConfig: isRec(st['config']) && Object.keys(rec(st['config'])).length > 0,
        placements: arr(st['field_refs']).map((p, pi) => ({
          id: `${sid}.fields.${pi}`,
          v: readPlacement(p),
        })),
      },
    };
  });
  const out: SrcTask = {
    id,
    key,
    name: str(t['name']) ?? key,
    triggered,
    ...(triggered ? { trigger: readTrigger(act['trigger_type'], rec(act['trigger_config'])) } : {}),
    activationId: `${id}.activation`,
    conditions: arr(t['conditions']).map((c, ci) => ({ id: `${id}.conditions.${ci}`, v: readCond(c) })),
    steps,
    effects: arr(t['effects']).map((e, ei) => ({ id: `${id}.effects.${ei}`, v: readEffect(e) })),
    ...(t['entry'] === true ? { entry: { id: `${id}.entry` } } : {}),
    ...(t['visual'] !== undefined && t['visual'] !== null ? { visual: { id: `${id}.visual` } } : {}),
  };
  return out;
}

function readRule(typeId: string, x: unknown, i: number): SrcRule {
  const a = rec(x);
  const key = str(a['key']) ?? `rule_${i}`;
  const id = `${typeId}.${K.rules}.${key}`;
  const trig = isRec(a['trigger'])
    ? readTrigger(rec(a['trigger'])['type'], rec(a['trigger']))
    : readTrigger(a['trigger_type'], rec(a['trigger_config']));
  return {
    id,
    key,
    name: str(a['name']) ?? key,
    trigger: { id: `${id}.trigger`, v: trig },
    ...(str(a['execution_mode'])
      ? { mode: { id: `${id}.execution_mode`, v: a['execution_mode'] as string } }
      : {}),
    steps: arr(a['steps']).map((s, si) => {
      const st = rec(s);
      const sid = `${id}.steps.${si}`;
      return {
        id: sid,
        v: {
          id: sid,
          name: str(st['name']) ?? `step_${si}`,
          when: { id: `${sid}.when`, v: readCond(st['when'] ?? []) },
          effects: arr(st['do']).map((e, ei) => ({ id: `${sid}.do.${ei}`, v: readEffect(e) })),
        },
      };
    }),
  };
}

function readTags(typeId: string, x: unknown): SrcTag[] {
  const out: SrcTag[] = [];
  const one = (id: string, m: Rec): void => {
    const filterBy = str(rec(m['config'])['filterBy']);
    const prop = m['fieldId'] ? unref(m['fieldId']) : undefined;
    out.push({
      id,
      tagType: str(m['tagType']) ?? '',
      ...(prop ? { prop } : {}),
      ...(filterBy ? { filterBy } : {}),
    });
  };
  arr(x).forEach((row, i) => {
    const r = rec(row);
    const mappings = arr(r['tag_mappings']);
    if (mappings.length > 0) mappings.forEach((m, j) => one(`${typeId}.field_tags.${i}.${j}`, rec(m)));
    else one(`${typeId}.field_tags.${i}`, r);
  });
  return out;
}

function readType(x: unknown, i: number, inventory: string[]): SrcType {
  const w = rec(x);
  const key = str(w['key']) ?? `type_${i}`;
  const id = `workflows.${key}`;
  const record = rec(w['record']);
  const doc = rec(w['document']);
  const push = (...ids: string[]): void => void inventory.push(...ids);
  push(id, ...Object.keys(record).map((c) => `${id}.${c}`));

  const props: SrcProp[] = arr(w[K.props]).map((p, pi) => {
    const e = rec(p);
    const pkey = str(e['key']) ?? `field_${pi}`;
    const pid = `${id}.${K.props}.${pkey}`;
    const prec = rec(e['record']);
    push(pid, ...Object.keys(prec).map((c) => `${pid}.${c}`));
    return { id: pid, key: pkey, record: prec };
  });
  const stages: SrcStage[] = arr(doc['stages']).map((s, si) => {
    const st = rec(s);
    const skey = str(st['key']) ?? `stage_${si}`;
    push(`${id}.stages.${skey}`);
    return {
      id: `${id}.stages.${skey}`,
      key: skey,
      name: str(st['name']) ?? skey,
      type: str(st['type']) ?? 'intermediate',
      hasPosition: isRec(st['position']),
    };
  });
  const edges = arr(doc['edges']).map((_, ei) => {
    push(`${id}.edges.${ei}`);
    return { id: `${id}.edges.${ei}` };
  });
  const tasks = arr(doc['tasks']).map((t, ti) => readTask(id, t, ti));
  for (const t of tasks) {
    push(t.id, t.activationId, ...t.conditions.map((c) => c.id), ...t.effects.map((e) => e.id));
    for (const s of t.steps) push(s.id, ...s.v.placements.map((p) => p.id));
    if (t.entry) push(t.entry.id);
    if (t.visual) push(t.visual.id);
  }
  const rules = arr(doc[K.rules]).map((a, ai) => readRule(id, a, ai));
  for (const r of rules) {
    push(r.id, r.trigger.id);
    if (r.mode) push(r.mode.id);
    for (const s of r.steps) push(s.id, s.v.when.id, ...s.v.effects.map((e) => e.id));
  }
  let tabs: SrcType['tabs'];
  if (isRec(doc['data_views'])) {
    const dvId = `${id}.data_views`;
    push(dvId);
    const list: SrcTab[] = arr(rec(doc['data_views'])['tabs']).map((t, ti) => {
      const tab = rec(t);
      push(`${dvId}.tabs.${ti}`);
      return {
        id: `${dvId}.tabs.${ti}`,
        name: str(tab['name']) ?? `tab_${ti}`,
        order: num(tab['order']) ?? ti,
        props: arr(tab['fields']).map((f) => unref(rec(f)[K.propId])),
      };
    });
    tabs = { id: dvId, tabs: list };
  }
  const tags = readTags(id, w['field_tags']);
  push(...tags.map((t) => t.id));
  return { id, key, record, props, stages, edges, tasks, rules, tabs, tags };
}

function readEntities(section: string, x: unknown, inventory: string[]): SrcEntity[] {
  return arr(x).map((e, i) => {
    const en = rec(e);
    const key = str(en['key']) ?? `${section}_${i}`;
    const id = `${section}.${key}`;
    const record = rec(en['record']);
    inventory.push(id, ...Object.keys(record).map((c) => `${id}.${c}`));
    return { id, key, record };
  });
}

/** Reads the export. `root` is the parsed `ProjectDefinition` (a YAML tree is joined by the caller). */
export function readProject(root: unknown): SrcProject {
  if (!isRec(root)) throw new V3ExportError('the v3 export must be an object');
  if (root['format'] !== 1) throw new V3ExportError('unknown v3 export format (expected format: 1)');
  if (!Array.isArray(root['workflows'])) throw new V3ExportError('the v3 export has no workflows list');
  const inventory: string[] = ['source.name', 'source.description'];
  const source = rec(root['source']);
  const settings = rec(root['settings']);
  inventory.push(...Object.keys(settings).map((k) => `settings.${k}`));
  const roles = readEntities('roles', root['roles'], inventory);
  const layers = readEntities('map_layers', root['map_layers'], inventory);
  const relations = readEntities('relations', root['relations'], inventory);
  const tables: SrcTable[] = arr(root['custom_tables']).map((t, i) => {
    const tb = rec(t);
    const key = str(tb['key']) ?? `table_${i}`;
    const id = `custom_tables.${key}`;
    const record = rec(tb['record']);
    inventory.push(id, ...Object.keys(record).map((c) => `${id}.${c}`));
    const columns = arr(tb['columns']).map((c, ci) => {
      const cr = rec(c);
      const cid = `${id}.columns.${str(cr['column_name']) ?? ci}`;
      inventory.push(cid);
      return { id: cid, record: cr };
    });
    return { id, key, record, columns };
  });
  const pages = arr(root['info_pages']).map((_, i) => {
    inventory.push(`info_pages.${i}`);
    return { id: `info_pages.${i}` };
  });
  const types = root['workflows'].map((w, i) => readType(w, i, inventory));
  return {
    name: str(source['name']) ?? 'project',
    description: str(source['description']) ?? '',
    settings,
    roles,
    tables,
    layers,
    pages,
    relations,
    types,
    inventory,
  };
}
