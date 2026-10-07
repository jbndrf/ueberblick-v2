import type { RequestHandler } from './$types';
import { start } from '../../join-handlers';

export const POST: RequestHandler = async (event) => {
  const form = await event.request
    .clone()
    .formData()
    .catch(() => null);
  return start({
    request: event.request,
    params: event.params,
    url: event.url,
    locals: event.locals,
    getClientAddress: event.getClientAddress,
    name: form?.get('name') ?? undefined,
  });
};
