import { packsDir, tilesDir } from '@ueberblick/server';

/** The per-project directories under `<dataDir>/blobs` that the Runtime hands out (A-037, A-044). */
export interface ProjectPaths {
  /** `<dataDir>/blobs/packs/<project>`: where the pack files of a project are built and served from. */
  packsDir(projectKey: string): string;
  /** `<dataDir>/blobs/tiles/<project>`: the uploaded tile archives of a project. */
  tilesDir(projectKey: string): string;
}

export const projectPaths = (dataDir: string): ProjectPaths => ({
  packsDir: (key) => packsDir(dataDir, key),
  tilesDir: (key) => tilesDir(dataDir, key),
});
