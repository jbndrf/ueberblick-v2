// The Safari write path (WP-650): the messages between the main thread and the pack writer worker. Typed and small;
// an unknown shape is refused, never ignored (R11). Not part of the sync host protocol.
import type { PackWriter } from './contract';

/** The slice of a `Worker` or a worker's `self` both sides use. */
export interface WriterPort {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** What the writer needs from a storage: open for writing at an offset, and replace a whole text file. */
export interface PackFileWriter {
  open(path: string, at: number): Promise<PackWriter>;
  writeText(path: string, text: string): Promise<void>;
}

export type WriterRequest =
  | {
      readonly id: number;
      readonly op: 'open';
      readonly handle: number;
      readonly path: string;
      readonly at: number;
    }
  | { readonly id: number; readonly op: 'write'; readonly handle: number; readonly chunk: Uint8Array }
  | { readonly id: number; readonly op: 'close'; readonly handle: number }
  | { readonly id: number; readonly op: 'text'; readonly path: string; readonly text: string };

export interface WriterReply {
  readonly id: number;
  readonly error?: string;
}

/** The wire tags of the requests: internal to this protocol, not domain values. */
const WRITER_OPS: readonly unknown[] = ['open', 'write', 'close', 'text'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseRequest(raw: unknown): WriterRequest {
  if (!isRecord(raw) || !Number.isInteger(raw['id']) || !WRITER_OPS.includes(raw['op']))
    throw new Error('writer: not a request');
  const ok =
    raw['op'] === 'open'
      ? Number.isInteger(raw['handle']) && typeof raw['path'] === 'string' && Number.isInteger(raw['at'])
      : raw['op'] === 'write'
        ? Number.isInteger(raw['handle']) && raw['chunk'] instanceof Uint8Array
        : raw['op'] === 'close'
          ? Number.isInteger(raw['handle'])
          : typeof raw['path'] === 'string' && typeof raw['text'] === 'string';
  if (!ok) throw new Error(`writer: ill-typed ${String(raw['op'])}`);
  return raw as unknown as WriterRequest;
}

export function parseReply(raw: unknown): WriterReply {
  if (!isRecord(raw) || !Number.isInteger(raw['id'])) throw new Error('writer: not a reply');
  return raw as unknown as WriterReply;
}
