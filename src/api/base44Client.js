import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  // The SDK's platform API is hosted on base44.app. Leaving this empty makes
  // every /api request same-origin, where Vercel's SPA fallback serves index.html.
  serverUrl: 'https://base44.app',
  // OAuth login/logout pages are app-scoped and must use the Base44 app origin,
  // not the Vercel frontend origin.
  appBaseUrl
});
