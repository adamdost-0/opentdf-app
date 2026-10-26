import type { PublicConfig } from '../shared.js';

export interface AppConfig extends PublicConfig {
  port: number;
  storageAccountUrl: string;
  storageContainer: string;
  managedIdentityClientId?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}

function guid(env: NodeJS.ProcessEnv, name: string): string {
  const value = required(env, name);
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Expected a GUID for ${name}`);
  }
  return value;
}

function endpoint(value: string): URL {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Endpoints require HTTPS and no credentials, query, or fragment',
    );
  }
  return url;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const tenantId = guid(env, 'ENTRA_TENANT_ID');
  const spaClientId = guid(env, 'ENTRA_SPA_CLIENT_ID');
  const apiAudience = guid(env, 'ENTRA_API_AUDIENCE');
  const platform = endpoint(required(env, 'OPENTDF_PLATFORM_URL'));
  const platformUrl = platform.href.replace(/\/$/, '');
  const kas = endpoint(env.OPENTDF_KAS_URL ?? `${platformUrl}/kas`);
  if (kas.origin !== platform.origin) {
    throw new Error('This MVP requires KAS on the configured platform origin');
  }
  const storage = endpoint(required(env, 'AZURE_STORAGE_ACCOUNT_URL'));
  if (
    storage.protocol !== 'https:' ||
    !/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/.test(storage.hostname) ||
    storage.pathname !== '/'
  ) {
    throw new Error('Expected an Azure Commercial Blob account HTTPS endpoint');
  }
  const attribute = required(env, 'OPENTDF_ATTRIBUTE');
  const attributeUrl = endpoint(attribute);
  if (!/^\/attr\/[^/]+\/value\/[^/]+$/.test(attributeUrl.pathname)) {
    throw new Error(
      'Expected an attribute FQN: https://namespace/attr/name/value/value',
    );
  }
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const storageContainer = env.AZURE_STORAGE_CONTAINER ?? 'files';
  if (!/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,61}[a-z0-9]$/.test(storageContainer)) {
    throw new Error('Invalid Azure Blob container name');
  }
  return {
    tenantId,
    spaClientId,
    apiAudience,
    apiScope: `api://${apiAudience}/Files.Access`,
    platformUrl,
    kasUrl: kas.href.replace(/\/$/, ''),
    attribute,
    port,
    storageAccountUrl: storage.origin,
    storageContainer,
    ...(env.AZURE_CLIENT_ID
      ? { managedIdentityClientId: guid(env, 'AZURE_CLIENT_ID') }
      : {}),
  };
}
