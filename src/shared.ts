export const MAX_PLAIN_BYTES = 10 * 1024 * 1024;
export const MAX_CIPHER_BYTES = 16 * 1024 * 1024;

export interface PublicConfig {
  tenantId: string;
  spaClientId: string;
  apiAudience: string;
  apiScope: string;
  platformUrl: string;
  kasUrl: string;
  attribute: string;
}

export interface FileSummary {
  id: string;
  size: number;
  createdAt: string;
}

export interface FilePage {
  files: FileSummary[];
  hasMore: boolean;
}
