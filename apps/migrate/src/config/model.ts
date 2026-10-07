/**
 * The converter's neutral view of a v3 project configuration (`read.ts` builds it). It is spoken in
 * v4 words; every node that can appear in the report carries the v3 path as its `id`. All v3 key
 * names live in `read.ts`, so nothing else in the converter depends on them.
 */
export type Rec = Record<string, unknown>;

/** A part of a v3 item that the report lists on its own. */
export interface Item<T> {
  readonly id: string;
  readonly v: T;
}

export type Cond =
  | { kind: 'all'; items: Cond[] }
  | { kind: 'any'; items: Cond[] }
  | { kind: 'not'; item: Cond }
  | { kind: 'field'; prop: string; op: string; value?: string; aggregate?: string; valueType?: string }
  | { kind: 'field_to_field'; prop: string; op: string; other: string }
  | { kind: 'stage'; op: string; stages: string[] }
  | { kind: 'role'; roles: string[] }
  | { kind: 'ownership'; value: string }
  | { kind: 'instance_status'; status: string }
  | { kind: 'related'; via: string; quantifier?: string; condition?: Cond }
  | { kind: 'unknown'; label: string };

export type Effect =
  | { kind: 'transition'; to: string }
  | { kind: 'snapshot' }
  | { kind: 'create_instance'; workflow?: string; intoProp?: string; geometry?: string }
  | { kind: 'set_field'; prop: string; value?: string; expression?: string }
  | { kind: 'clear_field'; prop: string }
  | { kind: 'set_instance_status'; status: string }
  | { kind: 'compute'; prop: string; expression: string }
  | { kind: 'unknown'; label: string };

export type Trigger =
  | { kind: 'on_transition'; from?: string; to?: string }
  | { kind: 'on_field_change'; props: string[]; stage?: string }
  | { kind: 'on_create' }
  | { kind: 'scheduled'; cron: string; stage?: string; inactiveDays?: number }
  | { kind: 'elapsed'; after: string; since: string }
  | { kind: 'when'; cond: Cond }
  | { kind: 'on_task_run'; task: string }
  | { kind: 'on_task_outcome'; task: string; outcome?: string }
  | { kind: 'unknown'; label: string };

export interface Prefill {
  readonly kind: string;
  readonly value?: string;
  readonly expression?: string;
}

/** One field of a task's form (a placement). */
export interface Placement {
  readonly prop: string;
  readonly required: boolean;
  readonly placeholder: boolean;
  readonly helpText?: string;
  readonly showIf?: Cond;
  readonly prefill: Prefill;
  readonly forceDirty: boolean;
  /** Addresses a field of a related (parent) feature. */
  readonly related: boolean;
  /** Uses page, row or column (layout that v4 leaves to the renderer). */
  readonly layout: boolean;
}

export interface FormStep {
  readonly kind: string;
  readonly mode?: string;
  readonly hasConfig: boolean;
  readonly placements: Item<Placement>[];
}

export interface SrcTask {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly triggered: boolean;
  readonly trigger?: Trigger;
  readonly activationId: string;
  readonly conditions: Item<Cond>[];
  readonly steps: Item<FormStep>[];
  readonly effects: Item<Effect>[];
  readonly entry?: { readonly id: string };
  readonly visual?: { readonly id: string };
}

export interface SrcRuleStep {
  readonly id: string;
  readonly name: string;
  readonly when: Item<Cond>;
  readonly effects: Item<Effect>[];
}

/** A v3 standalone rule set: trigger, execution mode and condition-guarded steps. */
export interface SrcRule {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly trigger: Item<Trigger>;
  readonly mode?: Item<string>;
  readonly steps: Item<SrcRuleStep>[];
}

export interface SrcColumnRecord {
  readonly id: string;
  readonly record: Rec;
}

export interface SrcProp {
  readonly id: string;
  readonly key: string;
  readonly record: Rec;
}

export interface SrcStage {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly type: string;
  readonly hasPosition: boolean;
}

export interface SrcTab {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly props: string[];
}

export interface SrcTag {
  readonly id: string;
  readonly tagType: string;
  readonly prop?: string;
  readonly filterBy?: string;
}

export interface SrcType {
  readonly id: string;
  readonly key: string;
  readonly record: Rec;
  readonly props: SrcProp[];
  readonly stages: SrcStage[];
  readonly edges: { readonly id: string }[];
  readonly tasks: SrcTask[];
  readonly rules: SrcRule[];
  readonly tabs: { readonly id: string; readonly tabs: SrcTab[] } | undefined;
  readonly tags: SrcTag[];
}

export interface SrcEntity {
  readonly id: string;
  readonly key: string;
  readonly record: Rec;
}

export interface SrcTable extends SrcEntity {
  readonly columns: SrcColumnRecord[];
}

export interface SrcProject {
  readonly name: string;
  readonly description: string;
  readonly settings: Rec;
  readonly roles: SrcEntity[];
  readonly tables: SrcTable[];
  readonly layers: SrcEntity[];
  readonly pages: { readonly id: string }[];
  readonly relations: SrcEntity[];
  readonly types: SrcType[];
  /** Every item id of the export, in reading order (the report must account for all of them). */
  readonly inventory: string[];
}
