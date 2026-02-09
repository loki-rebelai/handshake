import { createHttpClient } from '@silkyway/sdk/dist/client.js';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export const api = createHttpClient({ baseUrl: API_URL });
