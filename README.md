# OpenTDF Azure Files

A development MVP that keeps file plaintext in the browser, stores encrypted TDF objects in private Azure Blob Storage, and uses **OpenTDF policy evaluation and KAS key release** to control decryption.

This is an application scaffold, not a deployed or accredited service. Live Entra/OpenTDF compatibility and the allow/deny/revoke demonstration must be exercised in your environment. Azure Storage access alone is intentionally insufficient to decrypt a file.

## Start with the research

Three parallel research tracks covered the framework/SDK, identity/control boundaries, and deployment/operations. The sourced [research plan and findings](docs/research-plan.md) answer:

| Question                       | Working answer                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is OpenTDF?               | A data-centric protection framework: encrypted payloads, cryptographically bound policy, authorization services, and KAS-controlled payload-key release                                                      |
| What is the practical example? | Two users retrieve identical ciphertext from Azure; only the entitled user can decrypt; changing OpenTDF policy denies a subsequent fresh key request                                                        |
| What is Day 1?                 | Identity/policy bootstrap, protect/upload/list/retrieve/decrypt, and a real allow/deny/revoke demonstration                                                                                                  |
| What is Day 2?                 | Entitlement governance, key lifecycle, backup/restore, audit, upgrades, availability, cost, and sovereignty                                                                                                  |
| What can Azure/Entra own?      | Authentication/MFA/Conditional Access, entitlement claims, workload identity, storage/network access, operational secrets, and infrastructure telemetry—not OpenTDF's policy binding or key-release decision |

See the [approved design](docs/superpowers/specs/2026-10-25-opentdf-azure-mvp-design.md), [implementation plan](docs/superpowers/plans/2026-10-25-opentdf-azure-mvp.md), [identity setup](docs/identity.md), [Azure deployment](docs/deployment.md), and [Day 2 runbook](docs/operations.md).

## Application boundary

The browser uses MSAL and the official `@opentdf/sdk` **0.23.0**. The Node API validates signed, tenant-specific Entra access tokens, including the exact audience, calling SPA, delegated scope, and file-user role. It stores/retrieves bounded binary TDF objects through managed identity.

OpenTDF is self-hosted separately from the file API and retains claims resolution, subject mapping, authorization, policy-binding verification, and KAS rewrap. Its database and RSA/EC key material persist outside the container filesystem. Bicep provides a two-stage Azure deployment, not a dependency on an existing external platform.

The API lists opaque file IDs rather than original filenames. Maximum file sizes: **10 MiB plaintext**, **16 MiB TDF**. Catalog listing is limited to the first 100 objects and explicitly reports additional objects. There is no full document-management system.

## Local application development

Prerequisites: Node **24**, a configured Entra tenant, a reachable real OpenTDF platform with the fixture policy, and network/data-plane access to the Azure Blob account. The private Azure deployment normally requires a VNet-connected development host. There is no fake-authentication or plaintext-storage development mode.

```powershell
npm ci
Copy-Item .env.example .env
# Populate .env using docs\identity.md and deployment outputs.
az login --tenant <tenant-id>
```

The signed-in development identity needs Blob data permissions; Azure subscription Contributor is not a Blob data-plane role. Leave `AZURE_CLIENT_ID` empty locally. In Azure, the app uses its assigned managed identity.

Run the API and browser development server in separate terminals:

```powershell
npm run dev:api
```

```powershell
npm run dev:web
```

Open **http://127.0.0.1:5173**. Register that exact SPA redirect origin. Vite proxies `/api` to port 3000. The platform's development CORS configuration must explicitly permit that origin. This does not weaken or replace its authentication.

## Day 1 demonstration

1. Follow [tenant setup](docs/identity.md) and [deployment](docs/deployment.md), then bootstrap the fixture policy with a separate administrator token.
2. Sign in as the entitled user, select a small non-sensitive sample file, and **Encrypt and upload**.
3. **Download TDF** retrieves ciphertext; **Decrypt** invokes the real KAS and downloads plaintext locally only on success.
4. In a separate browser profile, sign in as an unentitled file user. The same file remains retrievable, but **Decrypt** must be denied by OpenTDF.
5. Follow the [revocation procedure](docs/operations.md). Confirm that the previously entitled identity receives a policy denial on a fresh key request against the unchanged ciphertext.

You cannot recall a plaintext copy or payload key already obtained. A cached access token and a changed OpenTDF subject mapping have different propagation behavior.

## Development checks and packaging

```powershell
npm test
npm run build
npm run format:check
az bicep build --file infra\main.bicep --stdout > $null
docker build --tag opentdf-azure-files:dev .
```

Unit tests exercise real JWT signature/claim validation, API denial/binary behavior, production static routing, bounded streams, and smoke failure classification. They do **not** prove live OpenTDF authorization. `npm run smoke` requires real identities and a running deployment; missing inputs fail rather than being reported as a passing skipped test. See [operations](docs/operations.md).

The multistage Docker image runs as the non-root `node` user. Production serves the UI and API from the same origin. CI builds the app/container and compiles Bicep without deploying Azure resources.

## Deliberate development limits

Direct Entra integration explicitly uses **bearer tokens, not proven DPoP-bound tokens**. The approved MVP accepts the resulting sender-constraint gap. App roles supply claims; OpenTDF remains the data-authorization authority.

KAS uses exportable development PEM keys, not a claimed native Azure Key Vault cryptographic provider. Browser encryption trusts the browser, delivered JavaScript, web origin, build pipeline, and authorized client. Upload magic-byte checks prevent common mistakes but are not trusted classification, DLP, or proof of encryption.

No production HA/DR assurance, malware scanning, large-file streaming, remote key custody, FedRAMP/ATO/IL accreditation, or government-profile/FIPS conformance is claimed. Do not use real regulated data before resolving the research evidence gates and production controls.
