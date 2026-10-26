# OpenTDF Azure file-access MVP design

Status: design and written specification approved in conversation.

## Decisions approved

- Self-contained Azure deployment boundary: application, OpenTDF platform, PostgreSQL, and Blob Storage.
- Plaintext is processed in the browser through the official TypeScript OpenTDF SDK.
- Direct Entra ID integration in explicit bearer-token mode. Sender-constrained-token replay risk is accepted for this development MVP.
- Azure Commercial dev/test baseline, Bicep infrastructure, no Azure or tenant deployment during scaffolding.

## Outcome

Demonstrate that possession of a file from Azure Storage is insufficient to read its content. A real OpenTDF policy decision and KAS key release must authorize every fresh decrypt. The repository must explain the framework, provide a practical example, distinguish Day 1 from Day 2, and identify which controls Azure/Entra can own without replacing OpenTDF.

## Architecture

The application container serves a browser UI and an authenticated same-origin file API. The browser uses Entra authorization code with PKCE and an access token for the configured API audience. The API and OpenTDF platform deliberately share that resource audience; the API separately requires its delegated scope and file-user role. Microsoft Graph tokens and ID tokens are not accepted.

The browser calls the OpenTDF platform over HTTPS for policy lookup and KAS operations. OpenTDF validates issuer/audience and uses claims-based Entity Resolution plus subject mappings. Normal users receive only the platform permissions necessary for policy reads and decrypt, never policy administration.

The API handles bounded TDF byte uploads, opaque identifiers, listing, and ciphertext retrieval using managed identity. It does not receive plaintext from the intended client flow, user passwords, application client secrets, or KAS private keys. Listing exposes identifiers, encrypted sizes, and timestamps, not original filenames.

Infrastructure comprises Azure Container Apps, an image registry, a VNet, private Blob Storage, PostgreSQL Flexible Server with private networking, secret handling, managed identities, and Log Analytics. OpenTDF ingress supports its required transport and explicit browser origins. Storage anonymous/shared-key access is disabled. Configuration and KAS keys survive container replacement.

Container Apps is an application-specific adaptation of OpenTDF deployment requirements, not an upstream-supported production reference architecture.

## Components and boundaries

| Component                    | Responsibility                                                                  | Depends on                                                          |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Browser UI                   | Sign-in, attribute selection, SDK protect/decrypt, explicit errors              | Entra, authenticated API, trusted OpenTDF endpoint                  |
| File API                     | Validate tokens/scope/role, limit and store/retrieve ciphertext                 | JWT discovery/JWKS, Blob SDK, managed identity                      |
| OpenTDF                      | Validate tokens, resolve claims, evaluate policy, enforce key release           | OIDC discovery, policy database, persistent KAS keys                |
| Bootstrap tooling            | Configure fixture attribute and mappings with administrator authorization       | Pinned administrative API/tooling, operator-supplied credentials    |
| Bicep and deployment scripts | Provision isolated application infrastructure and document tenant prerequisites | Azure CLI/Bicep, supplied tenant/resource identifiers, built images |

Use the simplest viable repository layout: application source, focused tests, infrastructure, operational scripts, and documentation. Pin upstream dependencies and validate actual APIs rather than recreating cryptography or inventing SDK wrappers.

## Identity and authorization

Use distinct roles for ordinary file access, the example project entitlement, and policy administration. An unentitled test user still has file API access, allowing retrieval of the same ciphertext without permission to decrypt it.

Use a tenant-specific issuer and exact audience; require the intended delegated API scope for application endpoints. Missing/invalid signature, issuer, audience, scope, or role is a denial. OpenTDF config explicitly selects claims resolution and replaces Keycloak-shaped role defaults.

Separate administrative bootstrap credentials from browser/runtime identity. Do not ship a policy-admin secret or client-credentials grant to the browser. App roles supply entitlement facts; OpenTDF owns the mapping from those facts to protected-data attributes.

DPoP is explicitly disabled for the direct-Entra MVP rather than pretending an unbound proof provides sender constraint. A future broker requires its own compatibility experiment. Key Vault may store operational secret material; no native remote Key Vault cryptographic custody is claimed.

## Data flow

1. A user signs in; the browser acquires an API access token into its configured browser authentication cache.
2. The user selects a local file of at most 10 MiB and the fixed example attribute.
3. The official SDK encrypts it locally, using the configured/trusted platform and KAS.
4. The authenticated API stores at most 16 MiB of encrypted bytes under a generated identifier.
5. Users with file API access can list and retrieve ciphertext; storage itself remains private.
6. The browser SDK reads that ciphertext and requests KAS rewrap as the current user.
7. KAS policy binding and Authorization determine whether plaintext is produced.

The UI does not perform an authoritative permission check before decrypting. Access-denied outcomes must originate in the real OpenTDF path. MIME/type checks and any manifest inspection are not proof of encryption or trusted classification; a malicious browser is outside that guarantee.

## Day 1 scope

Provide sign-in, protect/upload, list, retrieve encrypted file, decrypt, and sign-out. Include two-persona instructions and an operator-run subject-mapping revocation procedure. Verify the same blob hash before/after revocation and use a fresh SDK decrypt/key request.

Provide runnable local application development, documented real-platform integration inputs, Docker packaging, Bicep, tenant-configuration instructions, and policy/bootstrap artifacts. Local unit tests must not require Azure credentials. Real-platform smoke checks must fail, not silently skip into success, when required configuration is missing.

## Failure handling

Fail closed for invalid/expired tokens, unexpected audience/issuer, missing role/scope, policy denial, untrusted KAS, malformed TDF, storage failure, oversized upload, and unavailable platform. Present actionable but non-sensitive errors. Never fall back to plaintext storage, a service identity for user decrypt, or a mocked authorization result.

Log correlation IDs and bounded error categories, not tokens, plaintext, credentials, or private keys. Differentiate API authentication failure, KAS denial, and infrastructure unavailability.

## Validation

- Type-check and build against the selected installed SDK and Azure libraries.
- Unit-test API token/scope/role denial, identifier/body validation, and storage interaction without live credentials.
- Exercise actual SDK integration in the browser against a real OpenTDF platform.
- Provide a real-identity allow/deny/revoke smoke procedure; document all prerequisites and distinguish automated checks from manually observed evidence.
- Compile infrastructure and build container artifacts where the local tools are available.
- Do not represent passing mocks, a compilable template, or a generated deployment command as proof that Azure/Entra/OpenTDF integration works.

## Day 2 scope

Document policy change/rollback, stale-token versus policy-cache propagation, KAS endpoint durability, historical-key retention during rotation, DB/key backup and recovery, audit correlation, patching, capacity, cost, sovereignty, and separation of duties.

Production HA, cross-region DR, proven sender constraint, custom Key Vault KAS drivers, trusted classification/DLP, malware scanning, endpoint/browser compromise protection, large-file streaming, and accredited deployment are not included in this MVP.

Revocation cannot recall keys or plaintext already delivered. The application origin and delivered JavaScript are trusted: browser encryption does not make a compromised frontend operator harmless.

## Research basis

See [research plan and findings](../../research-plan.md) for public primary sources, unresolved compatibility gates, deployment comparisons, and control ownership.
