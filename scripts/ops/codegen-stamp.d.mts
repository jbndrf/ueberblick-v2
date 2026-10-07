export function inputsHash(files: string[], extra?: string): string;
export function upToDate(stampFile: string, hash: string, outputs: string[]): boolean;
export function writeStamp(stampFile: string, hash: string): void;
export function withLock<T>(
  lockDir: string,
  fn: () => Promise<T>,
  opts?: { staleMs?: number; pollMs?: number },
): Promise<T>;
export interface CodegenStep {
  name: string;
  inputs: () => { files: string[]; extra?: string };
  outputs: string[];
  run: () => Promise<void>;
}
export function runStep(step: CodegenStep, root: string): Promise<'skipped' | 'ran'>;
export function paraglideStep(project: string, outdir: string, root: string): CodegenStep;
export function kitSyncStep(root: string): CodegenStep;
export function allSteps(root: string): CodegenStep[];
export function runAllCodegen(root?: string): Promise<void>;
