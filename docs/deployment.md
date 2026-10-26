# Azure Commercial DEV/TEST deployment

This is an operator-run, **two-stage Bicep deployment**, not azd. The architecture was approved in conversation; `.azure\infrastructure-plan.json` records that approval. **No Azure deployment, tenant/subscription change, or real-identity integration was performed while scaffolding this repository.** Use synthetic data only. No ATO, FedRAMP, IL, government-cloud, FIPS-module, or production-readiness claim is made.

## What is provisioned

| Resource                   | Baseline and boundary                                                                                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container Apps environment | Workload profiles with a Consumption profile; external environment; delegated `10.42.0.0/24` subnet, exceeding the `/27` minimum; encrypted peer traffic                                            |
| File application           | Public HTTPS ingress to port 3000; 1 vCPU / 2 GiB; min=max=1; UI/API use the same origin                                                                                                            |
| OpenTDF                    | Public HTTPS/HTTP2 ingress to port 8080; 1 vCPU / 2 GiB; min=max=1; separate identity; persistent configuration/key secret volumes                                                                  |
| Blob Storage               | Private endpoint and private DNS; `files` container; public access, shared-key auth, and public network access disabled; HTTPS/TLS 1.2; infrastructure encryption; 7-day soft delete and versioning |
| PostgreSQL Flexible Server | PostgreSQL 16, Burstable `Standard_B1ms`, 32 GiB with auto-grow, 7-day local backups; private delegated `10.42.1.0/27` subnet and private DNS; no public access; TLS enforced                       |
| Container Registry         | **Premium**, required for private endpoint; private DNS; public network access, admin credentials, anonymous pull, and trusted-service network bypass disabled                                      |
| Managed identities         | App: Blob Data Contributor **at the `files` container only**, plus registry AcrPull. Platform: AcrPull only, not exposed to its runtime container                                                   |
| Monitoring                 | Log Analytics, 30-day retention, local-key authentication disabled; ACA console/system, Blob, PostgreSQL, and registry diagnostics                                                                  |

Private endpoints occupy `10.42.2.0/27`; the VNet is `10.42.0.0/16`. PostgreSQL's NSG permits port 5432 from the ACA and PostgreSQL subnets and denies other VNet inbound. Check address overlap before connecting an operator network. No VPN, firewall, build runner, unused Key Vault, or uninstrumented Application Insights resource is created. Azure Monitor uses public ingestion/query endpoints with Azure authorization; outbound dependencies are not forced through a firewall.

**Cost:** PostgreSQL, private endpoints/DNS, Log Analytics ingestion, Premium ACR, retained blob versions, and always-on app replicas have standing or usage charges. This is not a free-tier deployment. No billing configuration or budgets are created.

## Prerequisites

- Azure Commercial subscription and a **dedicated resource group**, selected explicitly in commands below. Verify location/SKU capacity, quota, organization policy, permitted CIDRs, and required resource providers before running deployment.
- Azure CLI with `az bicep` and a current Container Apps CLI extension for operational commands. Scaffolding used Bicep **0.37.4**. Do not change shared tools/services automatically.
- PowerShell **7.4 or newer** for the .NET RSA/ECDSA/certificate APIs and restricted file permissions.
- A deployment principal able to create the listed resources and role assignments in the dedicated group. Azure Contributor alone does not grant `Microsoft.Authorization/roleAssignments/write`; use a separately authorized RBAC administrator as required.
- The Entra registrations and assignments in [identity.md](identity.md): tenant-specific v2 access tokens; API resource client-ID GUID as the shared audience; delegated scope `Files.Access`; role `Files.User` for **both** users; entitlement `Project.Alpha` for only the allowed user; separate `Platform.Admin` assignment/token for policy bootstrap. Do not put an admin credential or application client secret into browser/runtime app configuration.
- A **separately supplied VNet-connected build/push runner** with Docker available, access to this source tree, outbound build/package sources, registry `AcrPush` permission, and private DNS resolution/connectivity to ACR. A peered VNet needs appropriate DNS zone links/forwarding; peering alone does not provide private-zone resolution. The runner is intentionally not provisioned by this template.
- A secured operator workstation/secret backup process. `.secrets\` and `*.local.json` must be Git-ignored. The generator verifies this before writing.

The implementation did not start or modify the unavailable local Docker daemon. Use an existing, approved runner; do not infer a successful image build from Bicep compilation.

## 1. Prepare stable parameters and persistent secrets

Run PowerShell from the repository root. Set these nonsecret values for your environment; using `--subscription` avoids changing the current CLI subscription.

```powershell
$subscription = '<subscription-guid>'
$resourceGroup = '<dedicated-dev-resource-group>'
$location = 'eastus2'

# An authorized operator creates this group, if it does not already exist.
az group create --subscription $subscription --name $resourceGroup --location $location --output none
if ($LASTEXITCODE -ne 0) { throw 'Resource group creation failed.' }

if (Test-Path infra\dev.local.json) { throw 'Keep the existing stable parameter file.' }
Copy-Item infra\dev.parameters.example.json infra\dev.local.json
```

Edit `infra\dev.local.json` with actual tenant, SPA, and API client-ID GUIDs. Keep lowercase alphanumeric `namePrefix` (3–12 characters), distinct stable app/platform names, region, and database login consistent across stages. The supplied names are `ca-otdfdev-files` and `ca-otdfdev-platform`. Replace the nonsecret placeholders; they are not usable identity configuration. If you customize the attribute FQN, bootstrap the same attribute later.

Generate secrets **once**:

```powershell
.\scripts\New-PlatformSecrets.ps1 -Generate
```

The script writes only under the ignored project `.secrets\` directory:

- `kas-private.pem`, `kas-cert.pem`: persistent RSA-2048 PKCS#8 private key and matching self-signed development public certificate, key ID `r1`.
- `kas-ec-private.pem`, `kas-ec-cert.pem`: persistent P-256 key/certificate, key ID `e1`.
- `postgresql-roots.pem`: Microsoft's recommended DigiCert Global Root G2 and Microsoft RSA Root CA 2017 certificates, downloaded from official URLs and checked against pinned SHA-256 fingerprints.
- `secrets.local.json`: ARM secure parameter values for the password, PEM pairs, and root bundle.

Generation uses .NET cryptographic RNG/certificate APIs, does not invoke OpenSSL, does not print secrets, and **refuses to overwrite existing material**. The directory DACL is restricted to the current Windows user; Unix permissions are restricted to its owner. Local administrators, endpoint compromise, disk backups, and a PowerShell debugger/transcript remain part of the workstation trust boundary. Do not use CLI `--debug`, shell tracing, upload these files to CI artifacts, or print their contents.

Back up this directory securely **before deployment**, with access separate from ordinary file users. Keep exactly the same `secrets.local.json` in both stages and on subsequent deployments. **Do not delete/regenerate it to make a rerun pass**: new keys can make old TDFs undecryptable and a new password can break the running platform. An interrupted first generation leaves partial files; stop and preserve/review them rather than automatically replacing historical material.

## 2. Deploy foundation only

These commands are instructions for an authorized operator; they were not executed during scaffolding. All deployments use **Incremental**, never Complete mode.

```powershell
az bicep build --file infra\main.bicep --stdout > $null
if ($LASTEXITCODE -ne 0) { throw 'Bicep validation failed.' }

az deployment group what-if --subscription $subscription --resource-group $resourceGroup `
  --template-file infra\main.bicep `
  --parameters '@infra\dev.local.json' '@.secrets\secrets.local.json' deployApps=false
if ($LASTEXITCODE -ne 0) { throw 'Foundation what-if failed.' }

# Review the what-if result before proceeding.
$foundationJson = az deployment group create --subscription $subscription `
  --resource-group $resourceGroup --name opentdf-foundation --mode Incremental `
  --template-file infra\main.bicep `
  --parameters '@infra\dev.local.json' '@.secrets\secrets.local.json' deployApps=false `
  --query properties.outputs --output json
if ($LASTEXITCODE -ne 0) { throw 'Foundation deployment failed.' }
$foundationJson | Set-Content -Encoding utf8 .secrets\foundation.outputs.local.json
$foundation = $foundationJson | ConvertFrom-Json
```

Secure values come **from parameter files**, not command-line plaintext. Foundation creates no Container Apps and needs no app image. It does create the database and empty private Blob container through ARM, so no Storage key or public data-plane exception is needed.

Outputs contain **nonsecret** resource IDs, names, identities, database host, and URLs. The app/platform URLs are:

```text
https://<stable-app-name>.<environment.defaultDomain>
https://<stable-platform-name>.<environment.defaultDomain>
https://<stable-platform-name>.<environment.defaultDomain>/kas
```

They are expected origins at this point, **not ready services**. Configure the SPA redirect URI to the exact application origin per [identity.md](identity.md). The origin used here must match the delivered frontend, not localhost or a wildcard.

This stage boundary avoids a circular dependency: neither foundation URL depends on a Container App resource, and stage two's YAML is generated after the real environment domain exists.

## 3. Build and push an immutable app image

Run this section on the approved **VNet-connected Docker runner**, with access to the stage-one nonsecret outputs. Confirm ACR login and regional data endpoint names resolve to private addresses and HTTPS is reachable. Do not temporarily enable public registry access to bypass a failed runner setup.

```powershell
$foundation = Get-Content .secrets\foundation.outputs.local.json -Raw | ConvertFrom-Json
$registryName = $foundation.registryName.value
$registryLoginServer = $foundation.registryLoginServer.value

Resolve-DnsName $registryLoginServer
az acr show --subscription $subscription --name $registryName `
  --query dataEndpointHostNames --output tsv
# Resolve each returned data endpoint as well; it must reach this registry's private endpoint.
Test-NetConnection $registryLoginServer -Port 443

az acr login --subscription $subscription --name $registryName
if ($LASTEXITCODE -ne 0) { throw 'Private registry login failed.' }
$tag = 'dev-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$taggedImage = "${registryLoginServer}/opentdf-files:$tag"
docker build --platform linux/amd64 --tag $taggedImage .
if ($LASTEXITCODE -ne 0) { throw 'Image build failed.' }
docker push $taggedImage
if ($LASTEXITCODE -ne 0) { throw 'Image push failed.' }
$appDigest = az acr repository show --subscription $subscription --name $registryName `
  --image "opentdf-files:$tag" --query digest --output tsv
if ($LASTEXITCODE -ne 0 -or $appDigest -notmatch '^sha256:[a-f0-9]{64}$') {
  throw 'Could not resolve the pushed immutable image digest.'
}
$appImage = "${registryLoginServer}/opentdf-files@$appDigest"
```

There is **no imaginary prepublished application image**. The generator requires your pushed `repository@sha256:digest` reference. ACR is private Premium with trusted-service bypass disabled: ordinary hosted CI runners and an unconfigured `az acr build` do **not** automatically have access. Use a properly connected runner or separately engineered private task pool; this repository provisions neither.

The default OpenTDF image is pinned independently of the JavaScript SDK:

```text
registry.opentdf.io/platform:v0.29.0
registry.opentdf.io/platform@sha256:5f0996865aefc46e30e35e219576906a648c15e217575f243a888a0ab842cbf0
```

The tag has a **`v` prefix**. The digest is the multi-architecture OCI index, independently hashed and matched to the registry's `Docker-Content-Digest` response. The index includes Linux amd64 and arm64. Pinning proves content identity, not provenance, signature verification, vulnerability safety, or runtime compatibility.

Default platform pulls need outbound access to `registry.opentdf.io` and its image-layer delivery endpoints. To retain a private copy, optionally mirror using the same connected runner:

```powershell
$platformSource = 'registry.opentdf.io/platform@sha256:5f0996865aefc46e30e35e219576906a648c15e217575f243a888a0ab842cbf0'
docker pull --platform linux/amd64 $platformSource
if ($LASTEXITCODE -ne 0) { throw 'Platform pull failed.' }
docker tag $platformSource "${registryLoginServer}/opentdf-platform:v0.29.0"
if ($LASTEXITCODE -ne 0) { throw 'Platform tag failed.' }
docker push "${registryLoginServer}/opentdf-platform:v0.29.0"
if ($LASTEXITCODE -ne 0) { throw 'Platform mirror push failed.' }
$platformDigest = az acr repository show --subscription $subscription --name $registryName `
  --image 'opentdf-platform:v0.29.0' --query digest --output tsv
if ($LASTEXITCODE -ne 0 -or $platformDigest -notmatch '^sha256:[a-f0-9]{64}$') {
  throw 'Could not resolve mirrored platform digest.'
}
$platformImage = "${registryLoginServer}/opentdf-platform@$platformDigest"
```

A single-architecture mirror can have a different digest from the source index; use the digest actually pushed. Pass `-PlatformImage $platformImage` to the next command if mirroring. Do not substitute a mutable tag.

## 4. Generate runtime configuration and deploy apps

On the secured operator machine that retains the original `.secrets\` directory, set `$appImage` to the nonsecret immutable reference from the previous section.

```powershell
.\scripts\New-PlatformSecrets.ps1 -Configure `
  -ParametersPath infra\dev.local.json `
  -FoundationOutputsPath .secrets\foundation.outputs.local.json `
  -AppImage $appImage
# For a mirrored platform, add: -PlatformImage $platformImage

az deployment group what-if --subscription $subscription --resource-group $resourceGroup `
  --template-file infra\main.bicep --parameters '@.secrets\runtime.local.json'
if ($LASTEXITCODE -ne 0) { throw 'Apps what-if failed.' }

# Review the what-if result before proceeding.
az deployment group create --subscription $subscription --resource-group $resourceGroup `
  --name opentdf-apps --mode Incremental --template-file infra\main.bicep `
  --parameters '@.secrets\runtime.local.json' --query properties.outputs --output json
if ($LASTEXITCODE -ne 0) { throw 'Apps deployment failed.' }
```

`runtime.local.json` merges the stable parameters and **existing** secrets, sets `deployApps=true`, and supplies the generated origin-specific YAML. It also generates a nonsecret `revisionSuffix` for both apps: [ACA secret updates do not automatically restart revisions](https://learn.microsoft.com/azure/container-apps/manage-secrets), so a new configuration file must produce a fresh revision even when the image is unchanged. The script validates GUIDs, foundation names/region/login, HTTPS origins, and digest references; rejects stage drift and images outside the supplied private ACR (except the official platform repository); and refuses output paths outside `.secrets\`, symlink/junction paths, and overwrites.

For a same-input rerun, reuse the existing file directly. For a reviewed image/config update, retain the original keys/password and generate a new file with `-RuntimeFileName runtime-next.local.json`; deploy that file explicitly. The script is **not** a key-rotation or database-password-rotation tool. Never rerun `-Generate` as an upgrade step.

Main Bicep parameters support a foundation-only deployment without app credentials/image, but the conditional app module rejects missing identity GUIDs, empty images, and empty keys/configuration. Mutable tag-only image references fail evaluation. Use the generator rather than bypassing its stronger full-digest and cross-stage consistency checks.

## Verified platform configuration contracts

The generated configuration follows **tagged `service/v0.29.0` source**, not moving chart defaults:

- The Docker entrypoint is `/usr/bin/opentdf`; the correct invocation is `start --config-file /etc/opentdf/opentdf.yaml`. There is no invented `serve` command or `--config` flag.
- `mode: [all]` provides the modular monolith. `services.entityresolution.mode: claims` is implemented for the pinned version; no Keycloak credentials or Graph directory lookup are required.
- `server.auth.issuer` is `https://login.microsoftonline.com/<tenant>/v2.0`; `audience` is the **API client-ID GUID**. `groups_claim: roles`, `username_claim: sub`, `client_id_claim: azp`, and Casbin extensions map `Files.User` to `role:standard` and `Platform.Admin` to `role:admin`. **Do not map `Project.Alpha` to admin**; entitlement-to-attribute mapping is separate policy bootstrap.
- `server.auth.dpop.enforce: false` is explicit. Direct Entra bearer replay risk is accepted for this MVP; this is not sender-constrained authentication.
- CORS permits only the exact app HTTPS origin, GET/POST/OPTIONS, and enumerated SDK/Connect headers. Bearer authorization does not require cross-origin cookies. Administrative CLI calls are not subject to browser CORS.
- `services.kas.key_management: false`, `rsacertid: r1`, `eccertid: e1`, and `server.cryptoProvider.type: standard` load persistent RSA and EC PEMs. The cert-ID fields are upstream's legacy-compatible path. **No built-in Azure Key Vault remote KAS driver is claimed.**
- The tagged Go DB struct uses **`runMigrations` plural**, so YAML uses `db.runMigrations: true`. When that key is present in the file, the corresponding Viper override is **`OPENTDF_DB_RUNMIGRATIONS`**. The tagged configuration markdown table's singular `runMigration` / `OPENTDF_DB_RUNMIGRATION` is stale. Do not use it to control migrations.
- The YAML includes `db.password: ""` so the legacy loader discovers that key; **`OPENTDF_DB_PASSWORD`** supplies the actual ACA secret. Other verified names are `OPENTDF_DB_HOST`, `OPENTDF_DB_DATABASE`, `OPENTDF_DB_USER`, and `OPENTDF_DB_SSLMODE`; the scaffold sets these nonsecret values in YAML.
- Go uses pgx **v5.9.2**, which honors **`PGSSLROOTCERT`**. `db.sslmode: verify-full` verifies the server hostname and chain against the mounted public root bundle; it does not silently use `prefer`/`require` or disable verification. Keep the normal PostgreSQL FQDN even though private DNS resolves it privately.
- HTTP readiness uses `/healthz?service=all` (registered dependency checks); liveness uses `/healthz`. These probes are useful, but KAS's upstream readiness implementation does not exercise a real key-release decision.

Upstream source: [Dockerfile](https://raw.githubusercontent.com/opentdf/platform/service/v0.29.0/Dockerfile), [CLI root flags](https://raw.githubusercontent.com/opentdf/platform/service/v0.29.0/service/cmd/root.go), [start](https://raw.githubusercontent.com/opentdf/platform/service/v0.29.0/service/cmd/start.go), [DB struct](https://raw.githubusercontent.com/opentdf/platform/service/v0.29.0/service/pkg/db/db.go), [legacy loader](https://raw.githubusercontent.com/opentdf/platform/service/v0.29.0/service/pkg/config/legacy_loader.go), [claims ERS](https://raw.githubusercontent.com/opentdf/platform/service/v0.29.0/service/entityresolution/entityresolution.go), [example YAML](https://raw.githubusercontent.com/opentdf/platform/service/v0.29.0/opentdf-example.yaml), [health](https://raw.githubusercontent.com/opentdf/platform/service/v0.29.0/service/health/health.go), and [official chart reference](https://github.com/opentdf/charts/tree/main/charts/platform).

### Deliberate secret/database exceptions

Container Apps secrets are the operational secret store. The platform mounts them read-only; the app never receives KAS private keys or the database password. Authorized ACA/ARM secret administrators can recover or replace them: **these are exportable software keys, not HSM/non-exportable custody**. No ephemeral filesystem is the authoritative key or policy store.

PostgreSQL password authentication is intentional because automatic managed-identity DB token refresh was not verified in the pinned platform. For this dedicated development server, OpenTDF uses the server administrator so initial schema migrations can run. This is a **privileged runtime/DDL exception**, not production least privilege. Production requires a separately operated migration identity and constrained runtime login, credential rotation, recovery testing, and any remote key-provider engineering. There is no application OAuth client secret.

ACA terminates external HTTPS; the container listens HTTP/h2c inside the managed environment, whose peer-traffic encryption is enabled. No external insecure ingress is allowed. This is not end-to-end application-managed TLS or evidence of a validated FIPS module.

## First run and evidence gates

Allow Azure RBAC/DNS propagation, inspect image pulls and readiness, then confirm:

```powershell
$foundation = Get-Content .secrets\foundation.outputs.local.json -Raw | ConvertFrom-Json
$appUrl = $foundation.applicationUrl.value
$platformUrl = $foundation.opentdfPlatformUrl.value
Invoke-WebRequest "$platformUrl/healthz?service=all" -Method Get | Select-Object StatusCode
Invoke-WebRequest $appUrl -Method Get | Select-Object StatusCode

az containerapp show --subscription $subscription --resource-group $resourceGroup `
  --name $foundation.deploymentSettings.value.platformName `
  --query '{provisioning:properties.provisioningState,running:properties.runningStatus}' --output json
```

Read logs through Azure Monitor/Log Analytics with an appropriately authorized operator. Do not enable debug/trace token or SQL logging to troubleshoot normal integration.

Then follow [identity.md](identity.md) and the policy bootstrap/demo procedure in [operations.md](operations.md). Policy initialization and administrative tokens are **not** embedded in Bicep. A successful health response is not proof of token compatibility or authorization.

Required operational evidence:

1. Entitled and unentitled users both have `Files.Access` plus `Files.User` and can retrieve **identical ciphertext** through the app.
2. Browser SDK protects and freshly decrypts a real TDF as the entitled user; unentitled key release is denied by OpenTDF, not a UI guard.
3. Subject mapping revocation denies a **fresh** decrypt/key request, with unchanged blob hash and measured propagation.
4. Invalid audience/tenant/expired tokens, missing scope/role, platform loss, and private Storage failures fail closed.
5. Normal file users cannot administer policy; anonymous/shared-key/public-network Blob access fails.
6. Container replacement preserves required KAS keys and DB state; recovered DB plus historical keys can decrypt historical objects.

## Reruns, upgrades, and recovery

- Foundation reruns with `deployApps=false` in **Incremental** mode do not delete existing apps. They do reapply foundational settings, including the supplied database password. Always retain the same parameters unless performing an explicit reviewed change.
- Initial startup migration is enabled for a single initial platform revision with max replicas 1. **Single-revision mode is not a migration lock**: ACA can overlap old and new replicas during rollout. Do not blindly perform rolling schema upgrades. Plan a maintenance window, quiesce the old writer, back up the database/keys, and run a single controlled migration before starting the new writer. A production migration job/workflow is not included.
- The verified upstream manual migration command is `/usr/bin/opentdf migrate up --all --config-file /etc/opentdf/opentdf.yaml`, with the same configuration, secret, CA bundle, and private DB access. A controlled migration process needs `runMigrations: true`; normal production runtime should be switched to `false` after migration. Do not execute a migration in a concurrently serving replica or assume migration rollback is lossless.
- Retain the stable KAS URL and historical private keys/key IDs as long as corresponding TDFs exist. Key rotation is **not** replacing the r1/e1 PEM values with new random keys. Retain old decrypt keys and test old/new TDFs; see [operations.md](operations.md).
- The generated self-signed public certificates have a two-year development lifetime. Review expiry and historical key/certificate retention; certificate renewal must not silently replace the private key.
- Seven-day local DB backups and Storage versioning/soft delete are development safeguards, not proven cross-region DR or independent immutable backup. Restore the policy DB and necessary historical KAS keys together and test recoverability. Do not delete the environment or its resource group before exporting required recovery material through an approved process.
- Monitor CPU/memory, PostgreSQL burst credits/connections/storage, key-release errors, API failures, audit ingestion, and log costs. No automated production alerts or budgets are configured.

## Validation performed and unresolved risks

| Check                     | Evidence                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bicep compilation         | `az bicep build --file infra\main.bicep --stdout > $null`: exit 0 on Bicep 0.37.4, zero template errors/warnings. CLI only advertised a newer Bicep release; no upgrade was made.                                                                                                     |
| PowerShell                | Parser: zero errors. Local execution verified RSA/EC key-certificate matches, pinned root downloads, existing key/password preservation, runtime config generation, overwrite refusal, stage-drift rejection, and output-path containment. Validation-generated secrets were removed. |
| Platform image            | v0.29.0 OCI index SHA-256 independently computed and matched registry digest; not executed.                                                                                                                                                                                           |
| Static security scan      | **Checkov unavailable** on PATH; no scan pass claimed. Manual hardening review checked private data services, disabled local/shared/public Blob auth, TLS, exact CORS, secure parameter flow, scoped RBAC, immutable images, persistent keys, backups, and no secret outputs.         |
| Azure MCP/live inspection | Azure schema/insights MCP tools unavailable; local skill constraints, bundled Bicep ARM types, and official Learn used instead. No live region/SKU/quota/policy/provider/diagnostic-category checks, what-if, deployment, or RBAC propagation verification.                           |
| Containers / integration  | Docker daemon unavailable and untouched. Image build/runtime, ACA private-registry pull, Go DB TLS handshake, startup migrations, HTTP2/browser CORS, Entra claims, SDK/platform interoperability, and allow/deny/revoke remain **live deployment gates**.                            |

Review the [research evidence gates](research-plan.md) before declaring the MVP operational. ACA hosting is an application-specific adaptation, not an upstream-supported production deployment reference. Browser-delivered JavaScript and devices remain trusted; revocation cannot recall plaintext or keys already delivered.
