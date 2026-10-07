/** Filter builder tables (clauses, editors, operators): a subpath, not in the registry barrel (WP-815). */
export {
  FILTER_CLAUSE_KINDS,
  FILTER_EDITORS,
  FILTER_EDITOR_BY_TYPE,
  FILTER_PRESENCE_STATES,
  type FilterPresence,
  FILTER_WHEN_FIELDS,
  FILTER_WHEN_MODES,
  FILTER_WHEN_SYSTEM,
  FILTER_CREATED_BY_SYSTEM,
  type FilterClauseKind,
  type FilterEditor,
  type FilterWhenField,
  type FilterWhenMode,
} from './filter-clauses';
export { FILTER_OPERATORS, FILTER_OPERATORS_BY_TYPE, type FilterOperator } from './filters';
