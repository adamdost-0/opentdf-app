# Day 1 evidence and Day 2 runbook

## Establish real enforcement evidence

Use non-sensitive sample data. First complete identity, infrastructure, and policy bootstrap. Browser allow/deny behavior and `npm run smoke` exercise the actual SDK; unit tests alone are not authorization evidence.

For the CLI smoke test, supply short-lived **delegated access tokens issued to the configured SPA** for the two test users. The API validates `azp`; tokens from an unrelated public client or Azure CLI will not automatically work. For a controlled development experiment, tokens can be taken from each isolated test browser profile's API request Authorization header. Do not add production UI/token-export endpoints, put tokens in URLs, use external token-decoding sites, or save them to the repository.

Use secure prompts to avoid putting the literal tokens in shell history:

```powershell
$env:SMOKE_API_URL = 'https://<application-host>'
$env:SMOKE_FILE_ID = '<opaque-id-of-a-file-uploaded-through-the-browser>'
$allow = Read-Host 'Entitled user access token' -AsSecureString
$deny = Read-Host 'Unentitled user access token' -AsSecureString
$env:SMOKE_ALLOW_TOKEN = [System.Net.NetworkCredential]::new('', $allow).Password
$env:SMOKE_DENY_TOKEN = [System.Net.NetworkCredential]::new('', $deny).Password
$env:SMOKE_MODE = 'allow-deny'
npm run smoke
```

`OPENTDF_PLATFORM_URL` comes from `.env`. Both users must have `Files.User` and delegated `Files.Access`; only one has `Project.Alpha`. The tool verifies that both retrieve identical ciphertext, the entitled identity decrypts, and the other receives an explicit SDK permission denial. Network errors, expired tokens, malformed files, and file-API rejection are failures, not successful deny tests.

Record the reported ciphertext `sha256`, file ID, time, platform/SDK versions, and corresponding KAS audit events. The smoke tool does not persist plaintext; it clears its returned plaintext buffer after the allow check. This is not a claim that every runtime copy of a key or plaintext has been erased.

### Revoke through OpenTDF policy

In an administrative terminal, inject the separate admin token as in the identity guide and deliberately remove only the marked fixture mapping:

```powershell
$env:OPENTDF_MAPPING_ID = '<subjectMappingId-from-bootstrap>'
npm run policy:bootstrap -- --revoke
Remove-Item Env:\OPENTDF_ADMIN_TOKEN
```

Back in the test terminal:

```powershell
$env:SMOKE_MODE = 'revoked'
$env:SMOKE_EXPECTED_SHA256 = '<sha256-from-the-allow-deny-run>'
npm run smoke
Remove-Item Env:\SMOKE_ALLOW_TOKEN, Env:\SMOKE_DENY_TOKEN
Remove-Variable allow, deny
```

This uses a fresh SDK instance/key request and requires the same ciphertext hash. If a token expires, obtain a fresh token for the **same** user; authentication failure must not be counted as policy revocation. Investigate configured authorization/entity caches if propagation is delayed. Do not rerun bootstrap between revoke and the test.

The script refuses to delete an unmarked or differently bound mapping. Deletion of the fixture mapping is intentional operator action; it is not a production policy-management workflow. Restoring the fixture requires deliberately rerunning bootstrap with administrator authorization.

Already exported plaintext remains readable. Previously released keys may also permit continued access without contacting KAS. The system does not provide remote wipe or recall.

## Operational ownership

| Area         | Required Day 2 action                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Policy       | Separate administrator assignments; reviewed changes, audit trail, rollback, and entitlement review                        |
| Tokens       | Monitor issuer/JWKS availability and expiry; distinguish claim refresh from OpenTDF policy propagation                     |
| KAS keys     | Preserve key IDs, PEM material, and historical keys needed by existing TDFs; test decrypt before and after rotation        |
| Database     | Protect credentials and migrations; retain backups/PITR; test restoring policy data with the associated key material       |
| KAS endpoint | Keep the public URI durable: existing TDF key-access objects reference it; DNS/hostname replacement is not transparent     |
| Application  | Patch locked dependencies and images, review build provenance and frontend changes, enforce upload quotas before wider use |
| Audit        | Correlate Entra sign-in, API request ID, Storage data-plane, policy administration, and KAS authorization/rewrap events    |
| Availability | Monitor rewrap latency/error/denial rates and database health; distinguish liveness from dependency readiness              |
| Recovery     | Exercise loss/replacement of container, policy database, keys, and region; document observed RPO/RTO                       |
| Cost         | Budget for always-on platform/app replicas, PostgreSQL, private endpoints, image registry SKU, storage and log ingestion   |

### Keys and secrets

The development setup uses exportable PEM keys mounted from Container Apps secrets. This is not a Key Vault/HSM-backed KAS cryptographic provider, and a platform operator with key and ciphertext access can bypass normal policy evaluation. Separate duties and constrain privileged access.

Do not rerun key generation over existing keys or delete historical keys just because a new key is active. Retain and protect the original ignored deployment parameter file and recovery copies in an approved secret backup system, never source control. Losing KAS keys can make historical objects unrecoverable even if Blob and PostgreSQL backups are intact.

For rotation, first verify the pinned platform's supported standard-provider key-selection behavior, keep required old key IDs configured, create new objects with the intended active key, and validate both old and new objects before removing anything. Migration to newer key-management APIs or an Azure Key Vault plugin requires its own design and integration test.

### Upgrades and migrations

Pin platform image digests, SDK package versions, and administrative tooling independently. Test upgrades on a disposable restored policy database with representative historical TDFs before changing the deployment. The one-replica development migration approach is not a safe multi-replica production migration strategy.

Do not treat a container's `/healthz` or TCP probe as evidence that policy, identity, database, and key release all work. Add a non-sensitive synthetic end-to-end check and define SLOs before production.

### Audit handling

Application logs contain bounded error categories and request IDs, not raw bearer tokens or file content. KAS/policy audit events and Azure Storage diagnostics are separate signals; a successful blob read does not imply successful decryption. Confirm collection and retention, protect audit access, and avoid adding user claims or filenames without a data-handling review.

### Production gaps

Resolve sender constraint, trusted classification/DLP, malicious upload handling, quotas/rate limiting, endpoint/browser compromise, app supply-chain controls, key custody, independent least-privilege DB runtime roles, HA, tested DR, vulnerability scanning, and evidence retention before production.

National clouds require separate issuer/authority, DNS suffix, Graph, container registry, service availability, residency, and cryptographic-boundary verification. No Azure service attestation grants this application an ATO or establishes IL/FedRAMP/FIPS/government-profile compliance.
