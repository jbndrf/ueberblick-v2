import { z } from '../zod';

/** A `set` or `with` value: a string is an expression, other scalars are literals (A-004 item 9). */
export const ValueSchema = z.union([z.string().min(1), z.number(), z.boolean(), z.null()]);
