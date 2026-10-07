/** v3's builder frame, rebuilt on the Doc (WP-330): shell, registry and catalog. */
export { default as BuilderFrame } from './shell/BuilderShell.svelte';
export { getBuilderContext } from './shell/context';
export type { BuilderContext, SaveOutcome } from './shell/context';
export {
  BUILDER_VIEWS,
  DEFAULT_VIEW,
  SELECTION_KINDS,
  createBuilderRegistry,
  parseView,
  withView,
} from './shell/registry';
export type {
  BuilderRegistry,
  BuilderView,
  FocusHook,
  InspectorEntry,
  Selection,
  SelectionKind,
} from './shell/registry';
export { selectionForPath } from './shell/selection';
export { default as CatalogSidebar } from './catalog/CatalogSidebar.svelte';
export { buildInventory } from './catalog/inventory';
export type { Inventory } from './catalog/inventory';
export { CATALOG_MIME, createOp } from './catalog/ops';
export type { CatalogCreate } from './catalog/ops';
export { registerTaskPane } from './task';
export { registerFieldPane } from './field/register';
// The property ops the admin's Tabellen page reuses (WP-382): one set of ops for a property, whoever edits it (R1).
export { changeTypeOp, deletePropertyOps } from './field/ops';
export { addPropertyOp, removeOp, setLabelOp, setRequiredOp, slugKey } from '../lenses/data-model/ops';
export {
  dropPropertyPermsOps,
  propertyAudience,
  PROPERTY_ACTIONS,
  setPropertyAudienceOp,
  setPropertyRolesOp,
} from './field/perms';
export type { PropertyAction, PropertyAudience, SettableAudience } from './field/perms';
export { registerModelView } from './model/permissions';
// The matrix's whole-type edits, for the data page header's "Sichtbar für Rollen" and "Private Einträge" (WP-418): one op for the matrix and the header (R1).
export { cellOp as permissionCellOp, privateOp, privateState } from './model/permissions/ops';
export type { PrivateState } from './model/permissions/ops';
export { typeAudience } from './model/permissions/model';
export { registerCanvas, buildCanvas, renameTaskOp, setCanvasLayoutApi } from './canvas';
export type { CanvasModel, CanvasLayoutApi, PlacedNode } from './canvas';
export { registerStagePane } from './stage';
export { registerRulePane } from './rule';
export { registerTypeSettingsPane } from './type-settings/register';
export { default as RoleSelect } from './shared/RoleSelect.svelte';
export {
  RELATION_ERRORS,
  createRelation,
  deleteRelation,
  listRelations,
  relationKeyOf,
  typeOptions,
  updateRelation,
} from './relations/ops';
export {
  ON_DELETE_BEHAVIORS,
  RELATION_ATTACHMENTS,
  RELATION_DEFAULTS,
  RELATION_GEOMETRIES,
} from './relations/options';
export type {
  OnDeleteBehavior,
  RelationAttachment,
  RelationGeometry,
  RelationOptions,
} from './relations/options';
export type {
  RelationDeletion,
  RelationEdit,
  RelationEntry,
  RelationErrorCode,
  RelationInput,
  RelationSource,
  TypeOption,
} from './relations/ops';
export * from './icons';
export { buildFieldHub } from './model/fields/hub';
export { usedIn } from './model/fields/used-in';
export { buildTaskRows } from './model/tasks/model';
export { registerFormEditor } from './form/register';
export { registerCodeView, registerEntityYaml } from './code';
// The data page's ⋮ menu ops (WP-419): duplicate, import and remove an Objektart with what belongs to it.
export * from './model/types';
