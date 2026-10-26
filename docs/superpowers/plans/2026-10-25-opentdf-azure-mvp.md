# OpenTDF Azure MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a browser-encrypted Azure file application whose plaintext access is enforced by the real OpenTDF SDK/platform.

**Architecture:** Serve a vanilla TypeScript browser UI and bounded ciphertext API from one Node container. Entra supplies user access tokens; OpenTDF retains policy evaluation and KAS key release. Bicep provisions the application, platform, private storage/database, and supporting operational resources without performing a deployment.

**Tech Stack:** Node 24, TypeScript, Vite, Fastify, jose, MSAL Browser, `@opentdf/sdk` 0.23.0, Azure Blob/Identity SDKs, Node test runner, Bicep, PowerShell.

## Global Constraints

- Self-contained Azure deployment boundary: application, OpenTDF platform, PostgreSQL, and Blob Storage.
- Plaintext is processed in the browser through the official TypeScript OpenTDF SDK.
- Direct Entra ID integration in explicit bearer-token mode. Sender-constrained-token replay risk is accepted for this development MVP.
- Azure Commercial dev/test baseline, Bicep infrastructure, no Azure or tenant deployment during scaffolding.
- At most 10 MiB of plaintext and 16 MiB of ciphertext per file.
- No plaintext fallback, policy-admin browser credentials, public blobs, storage shared keys, or claims of accredited deployment.
- Work in the current initially empty checkout; do not create another checkout without consent.
- Real integration evidence is distinct from unit tests and template compilation.

---

## File map

| Paths                                                                       | Responsibility                                                                      |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `vite.config.ts`     | Locked dependencies, Node/browser builds, development proxy                         |
| `src\server\config.ts`, `auth.ts`, `storage.ts`, `app.ts`, `index.ts`       | Configuration, JWT validation, ciphertext storage, routes, process entrypoint       |
| `src\shared.ts`                                                             | Public configuration and file-summary contracts, file-size limits                   |
| `src\web\main.ts`, `tdf.ts`, `style.css`, `index.html`                      | Sign-in/UI, SDK operations, accessible presentation                                 |
| `tests\auth.test.ts`, `api.test.ts`, `tdf.test.ts`                          | Real JWT validation, API behavior, bounded SDK stream operations                    |
| `infra\main.bicep`, `infra\modules\*.bicep`                                 | Provision application infrastructure and OpenTDF deployment                         |
| `scripts\*.ps1`, `scripts\*.ts`                                             | Generate secret configuration, bootstrap fixture policy, real-identity smoke checks |
| `README.md`, `docs\identity.md`, `docs\operations.md`, `docs\deployment.md` | Run instructions, tenant setup, Day 2, deployment and integration gates             |
| `.github\workflows\ci.yml`, `Dockerfile`, `.dockerignore`, `.gitignore`     | Repeatable checks and packaging                                                     |

## Task 1: Authenticated ciphertext API

**Interfaces:** `loadConfig(env): AppConfig`; `createAuthenticator(config, keyResolver?): (authorization?: string) => Promise<void>`; `FileStore` exposes `list(): Promise<FileSummary[]>`, `put(id: string, bytes: Buffer): Promise<void>`, `get(id: string): Promise<Buffer>`; `buildApp(config, store, authenticate)` returns a Fastify instance.

- [x] Write the dependency manifest, shared contracts, and tests before implementation. Generate RSA JWTs with jose for tests; use no live tenant.

```typescript
test('rejects app-only tokens even when the file role is present', async () => {
  const token = await issueToken({ roles: ['Files.User'], scp: undefined });
  await assert.rejects(authenticate(`Bearer ${token}`));
});

test('rejects plaintext upload content types before storage', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/files',
    headers: { authorization: 'Bearer test', 'content-type': 'text/plain' },
    payload: 'not a protected file',
  });
  assert.equal(response.statusCode, 415);
  assert.equal(stored.size, 0);
});
```

- [x] Run `npm install`, then `npm test`. Expect failures for the absent server modules.
- [x] Implement strict tenant/audience/RS256 JWT validation, expiry and delegated scope/role checks; add a bounded Buffer parser for `application/octet-stream`, UUID identifiers, private/no-store responses, generic error codes and request IDs. Wire the Azure Blob SDK with managed identity, no connection-string branch.
- [x] Test valid user access, missing/wrong scope/role, expired/wrong audience/issuer, invalid identifier, binary roundtrip, oversized upload, and unavailable storage. Run `npm test` and `npm run typecheck`.

## Task 2: Browser SDK application and packaging

**Interfaces:** `PublicConfig` exposes tenant, SPA client, API scope, platform/KAS URLs and fixture attribute only. `protectFile(file, config, getToken): Promise<Uint8Array>` and `decryptFile(bytes, config, getToken): Promise<Uint8Array>` use the installed SDK without cryptographic substitutes. `collectBytes(stream, limit)` cancels on overflow.

- [x] Write bounded-stream tests first:

```typescript
test('cancels an oversized stream rather than uploading a truncated TDF', async () => {
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(3));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(collectBytes(source, 2), /limit/);
  assert.equal(cancelled, true);
});
```

- [x] Run `npm test` and observe the absent SDK-wrapper behavior.
- [x] Implement `OpenTDF` with bearer interceptor, explicit `disableDPoP: true`, configured platform, explicit KAS allowlist, create attributes, and bounded collection. Use a fresh SDK instance for every decrypt. Release readers after consumption.
- [x] Implement MSAL authorization code/PKCE, same-origin API calls, sign-in/sign-out, protect/upload, list, download encrypted, and decrypt/download. Use text-only DOM insertion for server data. Disable competing file operations and show request/error identifiers without tokens.
- [x] Add Vite production build, static serving, non-root multistage Docker packaging, environment example and CI. Run `npm test`, `npm run typecheck`, `npm run build`, and formatting checks.
- [x] If Docker is unavailable, record that container execution is unverified; do not start or modify shared Docker services.

## Task 3: Self-contained Azure deployment and operator evidence

**Interfaces:** Bicep accepts tenant/client IDs, immutable app/platform image references, stable application/platform resource names, and secure KAS/database configuration. Deployment outputs application/platform URLs and identities. Policy bootstrap consumes a separately obtained OpenTDF-admin token and creates/reuses the fixed example attribute and role subject mapping.

- [x] Record approved infrastructure insights/plan and verify ARM resource schemas and subnet/SKU pairings. Separate foundational resources from application resources to avoid endpoint/configuration dependency cycles.
- [x] Generate Bicep for workload-profile Container Apps networking, managed identities and Blob RBAC, Storage private endpoint/DNS, private PostgreSQL and persistence, OpenTDF secrets/config, HTTPS/HTTP2 platform ingress, explicit CORS, and Log Analytics. Secure parameters must not appear in outputs. Document unavoidable platform database/password and exportable KAS-key limitations.
- [x] Generate operator scripts using pinned source/type contracts. Secret generation writes only to ignored output paths and fails rather than replacing existing key material. Document image-building and two-stage deployment commands, Entra app registrations/roles/scope/v2 tokens, claims resolution, and policy bootstrap separately.
- [x] Add real-token smoke tooling that retrieves and hashes identical ciphertext, decrypts as the entitled identity, expects actual authorization denial for the unentitled identity, and supports a second run after policy revocation. Missing integration inputs must exit nonzero.
- [x] Run `az bicep build --file infra\main.bicep --stdout` with output redirected outside tracked sources. Run `checkov -d infra` if available; explicitly record unavailable tooling rather than presenting a skipped scan as passed.
- [x] Write `docs\deployment.md`, `docs\identity.md`, and `docs\operations.md` with exact prerequisites/commands, Day 1 demo steps, Day 2 key/DB recovery, historical keys, audit, costs, and production gaps.
- [x] Run final focused tests/build/typecheck/formatter, inspect `git diff --check`, review the implementation against the approved spec, and mark only observed evidence as complete.

## Execution and review

Execute inline in the current session. Research parallelism is complete; do not create implementation agents merely to repeat the same evidence. Review boundaries: API trust checks, browser SDK fidelity, and infrastructure/operator usability. Preserve source artifacts and leave actual tenant/resource deployment to an explicitly authorized operator.

## Execution record

The application, browser SDK flows, operator tools, infrastructure, and runbooks are implemented. One implementation specialist owned the independent infrastructure files; a separate code reviewer identified encoded-route authentication and MSAL redirect-cache defects, both reproduced and corrected with regression cases.

Observed evidence includes 28 passing local tests, a production TypeScript/Vite build, local production HTTP serving and unauthenticated route denial, Bicep compilation, and PowerShell syntax validation. Infrastructure tooling additionally exercised secret generation/configuration protections without deploying resources.

Docker engine execution, Checkov scanning, and live Azure/Entra/OpenTDF allow/deny/revoke evidence are unavailable or deliberately not performed. They remain explicit operator evidence gates, not passing checks or claims that the scaffold is already operational.
