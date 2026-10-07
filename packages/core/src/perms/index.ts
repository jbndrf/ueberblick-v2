/** core/perms: one permission section per feature type, compiled three ways (docs/02 F6). */
export { compilePerms, PermsCompileError } from './compile';
export { actorValue, parseSubject, roleSubject, rolesOfSubjects } from './actor';
export type * from './contract';
export { whoAdmits, everyone, allRolesWho, WHO_ADMIN, WHO_IMPORT, type TaskWho } from './who';
export { deriveRights, type DerivedRights } from './derived';
export { classifiedFor } from './classify';
