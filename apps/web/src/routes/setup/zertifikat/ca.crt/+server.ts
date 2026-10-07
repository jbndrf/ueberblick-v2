import { config } from '$lib/server/config';
import { caCertificateResponse } from '$lib/server/tls/downloads';

export const GET = () => caCertificateResponse(config().dataDir);
