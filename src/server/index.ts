import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createAuthenticator } from './auth.js';
import { createBlobStore } from './storage.js';

const config = loadConfig(process.env);
const app = await buildApp(
  config,
  createBlobStore(
    config.storageAccountUrl,
    config.storageContainer,
    config.managedIdentityClientId,
  ),
  createAuthenticator(config),
  process.env.NODE_ENV === 'production'
    ? fileURLToPath(new URL('../../web/', import.meta.url))
    : undefined,
);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.close().catch(() => {
      app.log.error('Server shutdown failed');
      process.exitCode = 1;
    });
  });
}
await app.listen({ port: config.port, host: '0.0.0.0' });
