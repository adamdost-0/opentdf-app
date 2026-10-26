import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { HttpError } from './errors.js';

export interface AuthConfig {
  tenantId: string;
  apiAudience: string;
  spaClientId: string;
}

export function createAuthenticator(
  config: AuthConfig,
  resolver?: JWTVerifyGetKey,
) {
  const authority = `https://login.microsoftonline.com/${config.tenantId}`;
  const issuer = `${authority}/v2.0`;
  const getKey =
    resolver ??
    createRemoteJWKSet(new URL(`${authority}/discovery/v2.0/keys`), {
      timeoutDuration: 5_000,
    });

  return async (authorization?: string): Promise<void> => {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
    if (!match?.[1]) throw new HttpError(401, 'invalid_token');
    let payload;
    try {
      ({ payload } = await jwtVerify(match[1], getKey, {
        algorithms: ['RS256'],
        issuer,
        audience: config.apiAudience,
        requiredClaims: ['exp', 'iat', 'sub', 'tid', 'azp'],
        clockTolerance: 5,
      }));
    } catch (error) {
      if (
        error instanceof errors.JWTInvalid ||
        error instanceof errors.JWTClaimValidationFailed ||
        error instanceof errors.JWTExpired ||
        error instanceof errors.JWSInvalid ||
        error instanceof errors.JWSSignatureVerificationFailed ||
        error instanceof errors.JWKSNoMatchingKey ||
        error instanceof errors.JOSEAlgNotAllowed
      ) {
        throw new HttpError(401, 'invalid_token');
      }
      throw error;
    }
    if (
      payload.tid !== config.tenantId ||
      payload.azp !== config.spaClientId ||
      payload.ver !== '2.0'
    ) {
      throw new HttpError(401, 'invalid_token');
    }
    const scopes =
      typeof payload.scp === 'string' ? payload.scp.split(' ') : [];
    if (
      !scopes.includes('Files.Access') ||
      !Array.isArray(payload.roles) ||
      !payload.roles.includes('Files.User')
    ) {
      throw new HttpError(403, 'file_access_required');
    }
  };
}
