# OpenTDF on Azure: research plan and findings

Research date: 2026-10-25. Target: an Azure Commercial development MVP, not an accredited production system.

## Research method

Three research subagents ran in parallel against public OpenTDF and Microsoft sources. Documentation/source inspection is complete; integration hypotheses remain subject to the gates below. No Azure tenant or live OpenTDF deployment was tested during research.

| Track                          | Questions                                                                                        | Evidence and deliverable                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| OpenTDF and SDK                | What is protected? Who releases keys? Which official SDK is maintained? How does a user decrypt? | Format, architecture, SDK source/API inventory, allow/deny/revoke experiment                          |
| Identity and control ownership | Can Entra be the issuer? Which claims and audiences are needed? What cannot Azure replace?       | OIDC/configuration sources, app-role mappings, control matrix, sender-constraint and key-custody gaps |
| Deployment and operations      | What must be provisioned? What is Day 1 versus Day 2? What fails during recovery or upgrades?    | Platform/chart prerequisites, Azure hosting comparison, operational acceptance criteria               |

Prefer tagged upstream source and the installed SDK's types over examples on moving documentation pages. Pin packages, platform images, and administrative tooling independently: their release numbers are not interchangeable.

## 1. What OpenTDF is

OpenTDF is an open-source data-centric protection framework built around the Trusted Data Format (TDF). A TDF object packages an encrypted payload with a manifest containing policy and key-access information. Azure Storage encryption alone is not equivalent: a downloaded TDF remains encrypted outside the storage account. OpenTDF is not itself a managed Azure service or a subscription to a commercial Virtru product.

An SDK creates and reads protected objects. The Policy Service manages attributes and subject mappings; Entity Resolution supplies trusted entity information; Authorization makes policy decisions; the Key Access Server (KAS) enforces key release. On a fresh decrypt, KAS verifies policy binding and authorization before rewrapping the payload key to the requesting client.

Sources:

- [OpenTDF specification](https://github.com/opentdf/spec)
- [Security concepts](https://github.com/opentdf/spec/blob/main/concepts/security.md)
- [Access-control concepts](https://github.com/opentdf/spec/blob/main/concepts/access_control.md)
- [Architecture](https://opentdf.io/architecture)
- [KAS](https://opentdf.io/components/key_access)

**Limits:** revocation can prevent future authorized key releases, not erase plaintext or keys already obtained. Do not promise instantaneous revocation: policy caches, existing tokens, and application state affect observed propagation. Removing a token claim requires a new token; changing an OpenTDF subject mapping is a different mechanism. Test both separately.

Do not equate the SDK's ZTDF naming with certification against a government profile. No certification is implied.

## 2. Practical example

Use a fictitious project attribute and two test users. Both may retrieve the same ciphertext through the application. Only one has the claim entitlement mapped to that attribute in OpenTDF.

1. Sign in with Entra and obtain an access token for the configured application/OpenTDF API audience, not Microsoft Graph.
2. Encrypt a small file in the browser using the official SDK and the configured attribute.
3. Upload the TDF bytes through an authenticated API into a non-public Blob container.
4. Retrieve the bytes as the entitled user and decrypt through a real KAS request.
5. Retrieve the identical bytes as the unentitled user; KAS must deny key release.
6. Remove the relevant OpenTDF subject mapping and repeat a fresh decrypt as the previously entitled user.
7. Confirm the blob hash has not changed. Record propagation time and verify the denial is from the real authorization path, not a UI condition.
8. Show that a previously exported plaintext copy remains readable. This is an intentional limitation, not a failed revocation test.

Keep least-privilege storage controls in place. There is no need for public blobs, broad Azure roles, or long-lived SAS tokens to demonstrate that storage access and plaintext access are distinct.

### SDK selection

The official SDK inventory lists Go, Java, and JavaScript. The browser MVP uses TypeScript and `@opentdf/sdk`; it does not depend on an unofficial Python implementation or the deprecated `@opentdf/client` package.

- [SDK inventory](https://opentdf.io/sdks)
- [JavaScript SDK](https://github.com/opentdf/web-sdk)
- [Published package](https://www.npmjs.com/package/@opentdf/sdk)
- [SDK implementation and option types](https://github.com/opentdf/web-sdk/blob/main/lib/src/opentdf.ts)
- [Authentication interceptors](https://github.com/opentdf/web-sdk/blob/main/lib/src/auth/interceptors.ts)

**Implementation gate:** verify the selected package version's actual exports and TypeScript signatures. Documentation and researcher reports differed on JavaScript DPoP defaults; do not depend on defaults. Configure bearer mode explicitly for the approved direct-Entra MVP.

## 3. Day 1 versus Day 2

| Area     | Day 1: working demonstration                                            | Day 2: sustained operation                                                         |
| -------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Identity | Entra registrations, scopes, user roles, issuer/audience validation     | Assignment governance, token expiry, Conditional Access changes, privileged access |
| Policy   | Namespace, attribute, KAS registration/key association, subject mapping | Reviewed changes, rollback, propagation measurements, separation of administration |
| Files    | Browser protection, private upload/list/retrieval, allow/deny           | Retention, deletion, metadata exposure, quotas, malware/DLP strategy               |
| Keys     | Generate and persist development KAS key material                       | Rotation with historical decryptability, compromise response, custody, recovery    |
| Platform | OpenTDF, PostgreSQL, HTTPS, trusted origins                             | Migrations, patching, image provenance, capacity, health and availability          |
| Recovery | Establish backup settings and document dependencies                     | Restore policy DB and required historical keys together; exercise recovery         |
| Evidence | Reproduce allow/deny/revoke with real identities                        | Correlate sign-in, API, Storage, policy-change, and KAS audit events               |
| Azure    | Deployable Bicep and managed identities                                 | Cost budgets, network hardening, DR, regional/cloud service availability           |

OpenTDF's quickstart is explicitly for evaluation/development. Its Helm chart is a useful deployment reference, not evidence that an Azure Container Apps adaptation is production-supported.

Sources:

- [Platform configuration](https://github.com/opentdf/platform/blob/main/docs/Configuring.md)
- [Consuming the platform](https://github.com/opentdf/platform/blob/main/docs/Consuming.md)
- [Official platform Helm chart](https://github.com/opentdf/charts/tree/main/charts/platform)
- [Azure Container Apps ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)
- [PostgreSQL backup and restore](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-backup-restore)

### Deployment approaches considered

| Approach                                                           | Benefit                                                   | Trade-off and decision                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Azure application plus an existing OpenTDF endpoint                | Smallest application footprint                            | Requires an independently operated platform; rejected for this repo's self-contained demonstration |
| Application and OpenTDF on Container Apps, with managed PostgreSQL | Complete Azure demonstration without a Kubernetes cluster | Selected for development; Azure-specific integration must be verified and operated by this project |
| Application and OpenTDF on AKS using the official chart            | Closest to upstream Kubernetes deployment artifacts       | Greater operational footprint; defer until a workload justifies it                                 |

For the application trust boundary, browser-side SDK processing was selected over a trusted plaintext-processing backend. This keeps normal backend/storage operations ciphertext-only, at the cost of browser-to-KAS connectivity and a trusted frontend origin/build pipeline.

## 4. Controls that Azure and Entra can own

| Control                                         | Delegate to                              | Boundary that remains                                                   |
| ----------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| Authentication, MFA, sign-in/device/risk policy | Entra ID and Conditional Access          | OpenTDF independently validates the access token                        |
| App-role assignments and entitlement inputs     | Entra ID                                 | OpenTDF subject mappings and Authorization decide object access         |
| Azure resource administration and elevation     | Azure RBAC and PIM                       | OpenTDF policy administration must also be authorized and separated     |
| App-to-Blob authentication                      | Managed identity and Azure Storage RBAC  | Blob access retrieves ciphertext; it does not release a TDF payload key |
| Storage/network isolation                       | Private endpoints, TLS, Azure networking | TDF encryption and trusted KAS validation remain necessary              |
| Operational secrets                             | Key Vault and managed identity           | Secret storage is not a native Key Vault KAS cryptographic provider     |
| Infrastructure monitoring                       | Azure Monitor and Log Analytics          | Collect OpenTDF decision/key-release audit events as a separate signal  |
| Payload encryption, policy binding, key release | **Keep in OpenTDF**                      | Do not replace with a UI check, SAS, gateway header, or storage role    |

### Integration cautions

- Configure tenant-specific discovery, the exact API audience, and claims-based Entity Resolution; do not leave Keycloak-specific role/ERS defaults in an Entra deployment.
- Prefer application roles over large directory group lists. JWT group overage can omit `groups`; a claims-only resolver does not automatically query Graph.
- Treat raw headers and ID tokens as invalid substitutes for API access tokens. Never forward an API token to Graph or arbitrary URLs embedded in an untrusted manifest.
- Direct Entra bearer-token issuance does not establish generic SDK-managed DPoP binding. This MVP explicitly accepts a sender-constraint residual risk; it does not claim parity with a proven DPoP-bound deployment.
- Research found a pluggable key-manager interface, not a verified built-in Azure Key Vault KAS provider. Custom remote key custody is separate engineering.
- Browser processing excludes normal backend plaintext handling, not compromise of browser-delivered JavaScript. The web origin, build pipeline, dependencies, and user device are trusted.

Sources:

- [OpenTDF OIDC boundary](https://github.com/opentdf/platform/blob/main/docs/OIDC.md)
- [Entity Resolution](https://opentdf.io/components/entity_resolution)
- [Key managers](https://opentdf.io/components/policy/keymanagement/key_managers)
- [Entra access-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)
- [Microsoft PoP support](https://learn.microsoft.com/en-us/entra/msal/dotnet/advanced/proof-of-possession-tokens)
- [Conditional Access](https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview)
- [Storage private endpoints](https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints)
- [Key Vault RBAC](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)

## 5. Evidence gates before declaring the MVP operational

| Gate                       | Required evidence                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SDK compatibility          | Pinned SDK builds; browser protects/opens a real TDF against the pinned platform                                                   |
| Direct Entra compatibility | Real tenant access tokens accepted for the correct audience; wrong tenant/audience rejected; claims resolver and role mapping work |
| Enforcement                | Same ciphertext: allow for one identity, deny for another, deny after policy revocation on fresh key request                       |
| Failure behavior           | Expired token, unavailable KAS, invalid TDF, and oversized upload fail explicitly; no plaintext fallback                           |
| Storage isolation          | API managed identity accesses private Blob; anonymous access and shared-key authentication disabled                                |
| Least privilege            | Normal file users cannot modify policy, register KAS keys, or obtain policy-admin tokens                                           |
| Recoverability             | Required KAS keys persist across replacement; policy data is not an ephemeral container filesystem                                 |
| Deployment                 | Bicep compiles, container builds, deployment inputs and tenant setup are documented; live verification is explicitly separate      |

## 6. Deferred production research

Investigate sender-constrained Entra federation, remote KAS key custody, trusted classification, endpoint compromise, large-file streaming, quotas, malware scanning, private-client connectivity, operational SLOs, and tested DR before expanding this MVP.

Azure Government/national clouds need separate authority, Graph, DNS, image-registry, service-availability, crypto-boundary, and data-residency verification. Azure service attestations do not accredit this application. No FedRAMP, ATO, IL, FIPS-module, or government-profile conformance is asserted.
