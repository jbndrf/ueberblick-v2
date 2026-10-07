import type { ZodType } from 'zod';
import { errorResponse } from './errors';
import type { Issue } from './contract';

/** The request body as text, or a 413 once it is over `max` bytes (the stream is cut, never buffered whole). */
async function readCapped(req: Request, max: number): Promise<string | Response> {
  const tooLarge = (): Response => errorResponse('payload_too_large', `The body is over ${max} bytes.`);
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return tooLarge();
  if (req.body === null) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const dotted = (path: readonly PropertyKey[]): string => path.map(String).join('.');

/** Parses the JSON body against a schema: the value, or the 400 / 413 response to send. */
export async function readBody<T>(req: Request, schema: ZodType<T>, max: number): Promise<T | Response> {
  const text = await readCapped(req, max);
  if (text instanceof Response) return text;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return errorResponse('invalid_body', 'The request body must be JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues: Issue[] = parsed.error.issues.map((i) => ({ path: dotted(i.path), message: i.message }));
  return errorResponse('invalid_body', 'The request body does not match the schema.', issues);
}
