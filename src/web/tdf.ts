import { authTokenInterceptor, OpenTDF } from '@opentdf/sdk';
import {
  MAX_CIPHER_BYTES,
  MAX_PLAIN_BYTES,
  type PublicConfig,
} from '../shared.js';

export async function collectBytes(
  source: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = source.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel('File size limit exceeded');
        throw new Error('File size limit exceeded');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function client(config: PublicConfig, getToken: () => Promise<string>) {
  return new OpenTDF({
    platformUrl: config.platformUrl,
    interceptors: [authTokenInterceptor(getToken)],
    disableDPoP: true,
    defaultReadOptions: {
      allowedKASEndpoints: [config.kasUrl],
      ignoreAllowlist: false,
    },
  });
}

export async function protectFile(
  file: Blob,
  config: PublicConfig,
  getToken: () => Promise<string>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (file.size === 0 || file.size > MAX_PLAIN_BYTES) {
    throw new Error('Select a nonempty file no larger than 10 MiB');
  }
  const sdk = client(config, getToken);
  try {
    const stream = await sdk.createTDF({
      source: { type: 'file-browser', location: file },
      attributes: [config.attribute],
      autoconfigure: true,
      defaultKASEndpoint: config.kasUrl,
      byteLimit: MAX_PLAIN_BYTES,
      mimeType: 'application/octet-stream',
    });
    return await collectBytes(stream, MAX_CIPHER_BYTES);
  } finally {
    sdk.close();
  }
}

export async function decryptFile(
  bytes: Uint8Array,
  config: PublicConfig,
  getToken: () => Promise<string>,
): Promise<Uint8Array<ArrayBuffer>> {
  if (bytes.byteLength > MAX_CIPHER_BYTES) {
    throw new Error('Encrypted file exceeds the 16 MiB limit');
  }
  const sdk = client(config, getToken);
  const reader = sdk.open({
    source: { type: 'buffer', location: bytes },
  });
  try {
    return await collectBytes(await reader.decrypt(), MAX_PLAIN_BYTES);
  } finally {
    await reader.close();
    sdk.close();
  }
}
