// @ueberblick/tool-search: loaded lazily by the app. The sources come from the project's `tools.search`
// settings, so the app builds the tool once it has them:
//   search: () => import('@ueberblick/tool-search').then((m) => m.createSearchTool({ geo, sources: m.readSearchSources(settings), primaryGeometry }))
export { createSearchTool, RESULT_LIMIT } from './search-tool';
export { centreOf, readSearchSources, searchFeatures } from './model';
export type { PrimaryGeometry } from './search-tool';
export type { SearchPorts, SearchResult } from './model';
