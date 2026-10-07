export interface CallFrame {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
}
export interface CpuProfile {
  readonly nodes: readonly { id: number; callFrame: CallFrame; children?: readonly number[] }[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}
export function scriptOf(callFrame: CallFrame): string;
export function byScript(profile: CpuProfile): Map<string, number>;
