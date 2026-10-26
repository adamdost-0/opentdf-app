import type { Configuration } from '@azure/msal-browser';
import type { PublicConfig } from '../shared.js';

export function authConfiguration(
  config: Pick<PublicConfig, 'spaClientId' | 'tenantId'>,
  origin: string,
): Configuration {
  return {
    auth: {
      clientId: config.spaClientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: origin,
      postLogoutRedirectUri: origin,
    },
    cache: { cacheLocation: 'sessionStorage' },
  };
}
