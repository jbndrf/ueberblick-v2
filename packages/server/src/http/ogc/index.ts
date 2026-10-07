export { createOgcHandlers, type OgcDeps, type OgcHandlers } from './handlers';
export { ogcHandlersFor } from './wiring';
export { conformanceClasses } from './discovery';
export { resolveWriteTask, type WriteChange, type WriteTaskResult } from './write-task';
export { coreCql2, coreCrs } from './core-seams';
export { CRS84, EPSG_4326, type Cql2Seam, type CrsSeam, type OgcSeams } from './seams';
export { RESIDUAL_SCAN_CAP } from './items';
