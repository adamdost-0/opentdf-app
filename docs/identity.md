# Entra identity and OpenTDF policy setup

## Registration and token contract

Use one tenant-specific **resource/API registration** for this development application and OpenTDF, and a separate **SPA registration**. The resource audience is deliberately shared; each service still authorizes its own endpoints.

| Setting                           | Value                                                             |
| --------------------------------- | ----------------------------------------------------------------- |
| Tenant                            | Single Azure Commercial Entra workforce tenant                    |
| API application ID URI            | `api://<resource-application-client-id>`                          |
| API access-token version          | `api.requestedAccessTokenVersion: 2` in the resource registration |
| Exposed delegated scope           | `Files.Access`                                                    |
| Expected `aud`                    | Resource application's client-ID **GUID**, not the `api://` URI   |
| Expected `iss`                    | `https://login.microsoftonline.com/<tenant-id>/v2.0`              |
| Expected API calling client `azp` | SPA application's client-ID GUID                                  |
| Delegated scope request           | `api://<resource-application-client-id>/Files.Access`             |

Define these **resource application roles** with distinct generated role IDs:

| Role value       | Allowed member types | Meaning                                                                       |
| ---------------- | -------------------- | ----------------------------------------------------------------------------- |
| `Files.User`     | User                 | File API access and OpenTDF standard/read-only platform permissions           |
| `Project.Alpha`  | User                 | Entitlement fact evaluated by the fixture subject mapping                     |
| `Platform.Admin` | User, Application    | Privileged policy/bootstrap administration; never assign to normal file users |

Configure SPA authentication with **Single-page application** redirect URIs, not confidential web-client secrets. Register the exact origin including the trailing `/`: local `http://127.0.0.1:5173/`, and the deployed application's HTTPS origin. The app uses authorization code with PKCE, not implicit grants.

MSAL uses `sessionStorage` so authentication state survives redirect navigation; the installed MSAL version rejects redirect flows with `memoryStorage`. The browser origin and its scripts remain trusted with this cache. Sign out and close the test profile after the experiment; session storage is not a defense against malicious same-origin JavaScript.

On the SPA registration, add the resource API's delegated `Files.Access` permission and grant the required tenant consent. Do not substitute Microsoft Graph permissions. Apply appropriate enterprise-application assignment requirements and Conditional Access/MFA policies.

Assign both test users `Files.User` on the **resource enterprise application**, but only the entitled user `Project.Alpha`. Multiple role assignments must be separate assignments; use your tenant's approved portal/Graph tooling. If assignment is required on the SPA enterprise application, assign the test users there as well. That assignment alone does not confer resource app roles.

Create a separate administrative client/service principal if machine bootstrap is needed. Assign only that principal the resource's `Platform.Admin` application role and request `api://<resource-client-id>/.default` through your approved certificate/federated-client tooling. Do not put an administrative credential or token in SPA configuration. The app's Blob managed identity does not need a policy-admin role.

## Application environment

Populate the `.env` values in the root example. `ENTRA_API_AUDIENCE` is the resource client-ID GUID; `ENTRA_SPA_CLIENT_ID` is the SPA client-ID GUID. The frontend requests the delegated scope derived from that resource ID.

The file API rejects missing/invalid signatures, expired tokens, other issuers/audiences/tenants/calling clients, non-v2 tokens, missing `Files.User`, and missing **delegated** `Files.Access`. An app-only token is not a substitute for an end-user token. ID tokens and Graph access tokens are not accepted.

Use app roles rather than directory-wide group lists for this fixture. Group overage can remove `groups` from the JWT; claims-only OpenTDF resolution does not automatically call Graph.

## OpenTDF platform configuration

The infrastructure secret generator supplies explicit settings for:

- Tenant-specific issuer and exact audience.
- `services.entityresolution.mode: claims`, not the Keycloak resolver.
- `server.auth.policy.groups_claim: roles`, `username_claim: sub`, and `client_id_claim: azp`.
- Casbin groupings `g, Files.User, role:standard` and `g, Platform.Admin, role:admin`.
- `server.auth.dpop.enforce: false` and browser SDK `disableDPoP: true`.
- Explicit browser origins and stable KAS URI.

The standard role grants platform reads; it does not automatically grant decryption entitlement. The fixture subject mapping separately maps `.roles[]` containing `Project.Alpha` to the protected attribute's `read` action.

**Compatibility gate:** source inspection and TypeScript compilation are not evidence that a live Entra token has passed the selected OpenTDF version's auth/claims/rewrap path. Verify this before claiming the demonstration works.

## Bootstrap policy

Set `OPENTDF_PLATFORM_URL`, `OPENTDF_KAS_URL`, and `OPENTDF_ATTRIBUTE` in `.env`. Default fixture FQN:

```text
https://demo.opentdf.local/attr/project/value/alpha
```

This is an attribute namespace identifier, not a host the browser must contact.

Inject a short-lived OpenTDF-audience token containing `Platform.Admin` into `OPENTDF_ADMIN_TOKEN` using your approved credential tooling. To enter an already obtained token without including it in shell history:

```powershell
$secureToken = Read-Host 'OpenTDF administrator access token' -AsSecureString
$env:OPENTDF_ADMIN_TOKEN = [System.Net.NetworkCredential]::new('', $secureToken).Password
npm run policy:bootstrap
Remove-Item Env:\OPENTDF_ADMIN_TOKEN
Remove-Variable secureToken
```

The script uses the official SDK's typed platform clients. It creates/reuses the namespace, ALL_OF attribute/value, KAS registry entry and legacy KAS grant, then a marked subject mapping for `Project.Alpha`. It checks existing marked mappings rather than overwriting their policy silently. It does not reactivate inactive policy. A failure may leave already created fixture objects; inspect and rerun after correcting the cause.

Record the returned `subjectMappingId` for the deliberate revocation experiment. Re-running bootstrap **after revocation re-grants** the fixture entitlement; do not run it automatically in the data-access test.

The current deployment uses upstream's standard PEM crypto-provider mode (`key_management: false`). The legacy KAS grant API remains typed in SDK 0.23.0; migration to upstream's newer key-management model is Day 2 engineering, not a silent substitution.

## Residual risks and non-equivalences

Bearer mode does not provide proven generic DPoP sender constraint. MFA/Conditional Access governs identity/token acquisition, not the per-file key-release decision. PIM/Azure RBAC protects resource administration, not TDF payload access. Never pass unsigned identity headers or silently exchange user identity for a broadly entitled service account.

Role removal in Entra normally requires fresh token issuance before the changed claim is observed. OpenTDF subject-mapping removal changes the policy evaluated for a fresh key request, subject to any configured caches. Measure both; do not promise immediate revocation.

Sources: [Entra SPA configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-configuration), [app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps), [token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference), [OpenTDF OIDC](https://github.com/opentdf/platform/blob/service/v0.29.0/docs/OIDC.md), [claims resolver source](https://github.com/opentdf/platform/blob/service/v0.29.0/service/entityresolution/claims/entity_resolution.go).
