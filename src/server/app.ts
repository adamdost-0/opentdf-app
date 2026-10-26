import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { MAX_CIPHER_BYTES, type PublicConfig } from '../shared.js';
import { HttpError } from './errors.js';
import type { FileStore } from './storage.js';

export async function buildApp(
  config: PublicConfig,
  store: FileStore,
  authenticate: (authorization?: string) => Promise<void>,
  staticRoot?: string,
) {
  const app = Fastify({
    bodyLimit: MAX_CIPHER_BYTES,
    requestTimeout: 30_000,
    logger: {
      level: 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
  });
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_CIPHER_BYTES },
    (_request, body, done) => done(null, body),
  );
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Request-Id', request.id);
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        `connect-src 'self' https://login.microsoftonline.com ${new URL(config.platformUrl).origin}`,
        "frame-src 'self' https://login.microsoftonline.com",
        "frame-ancestors 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
  });
  async function authorizeFileRequest(request: FastifyRequest) {
    await authenticate(request.headers.authorization);
    if (
      request.method === 'POST' &&
      request.headers['content-type'] !== 'application/octet-stream'
    ) {
      throw new HttpError(415, 'unsupported_content_type');
    }
  }
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof HttpError
        ? error.statusCode
        : error instanceof Error &&
            'statusCode' in error &&
            typeof error.statusCode === 'number' &&
            error.statusCode >= 400 &&
            error.statusCode < 500
          ? error.statusCode
          : 503;
    const code =
      error instanceof HttpError
        ? error.code
        : status === 413
          ? 'file_too_large'
          : status === 415
            ? 'unsupported_content_type'
            : status < 500
              ? 'invalid_request'
              : 'service_unavailable';
    request.log[status >= 500 ? 'error' : 'warn'](
      { code, requestId: request.id },
      'Request failed',
    );
    if (status === 401) reply.header('WWW-Authenticate', 'Bearer');
    reply.code(status).send({ error: code, requestId: request.id });
  });
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/api/config', async () => ({
    tenantId: config.tenantId,
    spaClientId: config.spaClientId,
    apiAudience: config.apiAudience,
    apiScope: config.apiScope,
    platformUrl: config.platformUrl,
    kasUrl: config.kasUrl,
    attribute: config.attribute,
  }));
  app.get('/api/files', { onRequest: authorizeFileRequest }, async () =>
    store.list(),
  );
  app.post(
    '/api/files',
    { onRequest: authorizeFileRequest },
    async (request, reply) => {
      const bytes = request.body;
      if (
        !Buffer.isBuffer(bytes) ||
        bytes.length < 4 ||
        !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      ) {
        throw new HttpError(400, 'invalid_tdf_container');
      }
      const id = randomUUID();
      await store.put(id, bytes);
      return reply.code(201).send({ id });
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/files/:id',
    { onRequest: authorizeFileRequest },
    async (request, reply) => {
      const { id } = request.params;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          id,
        )
      ) {
        throw new HttpError(400, 'invalid_file_id');
      }
      const bytes = await store.get(id);
      return reply
        .type('application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${id}.tdf"`)
        .send(bytes);
    },
  );
  if (staticRoot) {
    await app.register(fastifyStatic, { root: staticRoot, wildcard: false });
  }
  return app;
}
