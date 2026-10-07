import { config } from '$lib/server/config';
import { mobileconfigResponse } from '$lib/server/tls/downloads';

export const GET = () => mobileconfigResponse(config().dataDir);
