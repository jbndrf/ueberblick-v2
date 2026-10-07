export const PLANT_MARK: string;
export function isPlanted(path: string): boolean;
export function plant(root: string, files: Record<string, string>): { remove: () => void; paths: string[] };
export function withPlants<T>(root: string, files: Record<string, string>, fn: () => T): T;
