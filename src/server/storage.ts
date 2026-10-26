import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { MAX_CIPHER_BYTES, type FilePage } from '../shared.js';
import { HttpError } from './errors.js';

export interface FileStore {
  list(): Promise<FilePage>;
  put(id: string, bytes: Buffer): Promise<void>;
  get(id: string): Promise<Buffer>;
}

export function createBlobStore(
  accountUrl: string,
  containerName: string,
  managedIdentityClientId?: string,
): FileStore {
  const credential = new DefaultAzureCredential(
    managedIdentityClientId ? { managedIdentityClientId } : {},
  );
  const container = new BlobServiceClient(
    accountUrl,
    credential,
  ).getContainerClient(containerName);
  return {
    async list() {
      const files: FilePage['files'] = [];
      for await (const blob of container.listBlobsFlat()) {
        if (files.length === 100) return { files, hasMore: true };
        if (
          blob.properties.contentLength === undefined ||
          !blob.properties.createdOn
        ) {
          throw new HttpError(503, 'storage_metadata_unavailable');
        }
        files.push({
          id: blob.name,
          size: blob.properties.contentLength,
          createdAt: blob.properties.createdOn.toISOString(),
        });
      }
      return { files, hasMore: false };
    },
    async put(id, bytes) {
      await container.getBlockBlobClient(id).uploadData(bytes, {
        conditions: { ifNoneMatch: '*' },
        blobHTTPHeaders: { blobContentType: 'application/octet-stream' },
      });
    },
    async get(id) {
      const blob = container.getBlockBlobClient(id);
      try {
        const properties = await blob.getProperties();
        if (
          properties.contentLength === undefined ||
          properties.contentLength > MAX_CIPHER_BYTES
        ) {
          throw new HttpError(413, 'file_too_large');
        }
        if (!properties.etag) {
          throw new HttpError(503, 'storage_metadata_unavailable');
        }
        return await blob.downloadToBuffer(0, properties.contentLength, {
          conditions: { ifMatch: properties.etag },
        });
      } catch (error) {
        if (
          error instanceof Error &&
          'statusCode' in error &&
          error.statusCode === 404
        ) {
          throw new HttpError(404, 'file_not_found');
        }
        throw error;
      }
    },
  };
}
