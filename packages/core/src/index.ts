export * from './model';
export * from './ports';
export * from './registry';
// Compile-time and builder tables: not in the registry barrel so the participant shell never bundles them (WP-815).
export * from './registry/admin';
export * from './registry/compile';
export * from './registry/expr-errors';
export { MATCHES_SYNTAX_PROBLEMS, MATCHES_UNSUPPORTED_FEATURES } from './registry/expr-matches-problems';
export * from './registry/filter';
export * from './registry/tools';
export * from './schema';
export * from './marker';
export * from './template';
export * from './sync';
export * from './geo';
export {
  acceptLocales,
  displayName,
  localize,
  localizeExact,
  shortId,
  type Localizable,
  type NameSource,
} from './locale';
export * from './fold';
export { formApi, FormConfigError } from './form';
export type * from './form/contract';
export { SQL_APP_FUNCTIONS, propertySql, sqlApi, toSql } from './expr/sql';
export type {
  Chip,
  ChipsResult,
  ExplainPart,
  Explanation,
  SqlApi,
  SqlAppFunction,
  SqlMapping,
  SqlResult,
} from './expr/sql';
export {
  compilePerms,
  PermsCompileError,
  actorValue,
  roleSubject,
  whoAdmits,
  WHO_ADMIN,
  WHO_IMPORT,
  everyone,
  allRolesWho,
  deriveRights,
} from './perms';
export type * from './perms';
export {
  createPlan,
  featureAccess,
  NEW_FEATURE,
  oneVersion,
  PLAN_MAX_RULE_DEPTH,
  PlanConfigError,
} from './plan';
export { planRedaction } from './plan/redact';
export { bindingFieldsOf, sameRunBinding } from './plan/binding';
export type { RunBindingFields } from './plan/binding';
export { canonicalJson } from './schema/compile/hash';
export type { RedactPair, RedactionInput, RedactionPlan } from './plan/redact';
export type {
  ConfigFor,
  ResolvedConfig,
  PlanApi,
  PlanLimits,
  PlanPorts,
  RulePorts,
  PlanResult,
  PlannedRun,
  TaskTarget,
  Availability,
  FireResult,
  RuleFire,
} from './plan';
export { REFUSAL_CODES, type RefusalCode } from './registry/refusals';
export * from './prefs';
export * from './filters';
export { processesOf } from './process';
export { generateProperties, seededRng, spreadStage, type GenerateContext } from './generate';
export type { Process } from './process';
export { mapOrigins, type MapOriginsLike } from './map/origins';
export * from './display';
export * from './mentions';
export * from './filter/start';
