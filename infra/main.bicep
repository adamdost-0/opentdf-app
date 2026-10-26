targetScope = 'resourceGroup'

@description('Azure Commercial region. Confirm regional Container Apps and PostgreSQL availability before deployment.')
param location string = resourceGroup().location

@description('Stable lowercase alphanumeric workload prefix; do not change between stages.')
@minLength(3)
@maxLength(12)
param namePrefix string = 'otdfdev'

@description('Stable application Container App name; changing it changes the browser origin.')
@minLength(2)
@maxLength(32)
param appName string = 'ca-${namePrefix}-files'

@description('Stable OpenTDF Container App name; retain its URL for historical TDFs.')
@minLength(2)
@maxLength(32)
param platformName string = 'ca-${namePrefix}-platform'

@description('False provisions foundation only. True requires the generated runtime parameter file.')
param deployApps bool = false

@description('Nonsecret release identifier generated with each runtime parameter file; forces secret-only config changes into a fresh revision.')
@maxLength(32)
param revisionSuffix string = ''

@description('Single-tenant Entra directory GUID; required for app deployment.')
param entraTenantId string = ''

@description('Browser SPA application client-ID GUID; required for app deployment.')
param entraSpaClientId string = ''

@description('Shared API/OpenTDF resource application client-ID GUID (v2 access-token audience).')
param entraApiAudience string = ''

@description('Fixture attribute FQN. Policy bootstrap is a separate administrator operation.')
param opentdfAttribute string = 'https://demo.opentdf.local/attr/project/value/alpha'

@description('Operator-built application image in this deployment ACR, in repository@sha256:digest form. No default application image exists.')
param appImage string = ''

@description('OpenTDF service/v0.29.0 OCI index digest, resolved from the verified v0.29.0 tag. May be mirrored into this deployment ACR.')
@minLength(71)
param platformImage string = 'registry.opentdf.io/platform@sha256:5f0996865aefc46e30e35e219576906a648c15e217575f243a888a0ab842cbf0'

@description('Dedicated PostgreSQL administrator/runtime login for this development-only server.')
param databaseAdminLogin string = 'otdfadmin'

@description('Persistent PostgreSQL password. Supply from the same secure parameter file in both stages and on reruns.')
@secure()
@minLength(16)
param databaseAdminPassword string

@description('Persistent RSA PKCS#8 private key PEM; required only when deployApps=true.')
@secure()
param kasRsaPrivatePem string = ''

@description('RSA public certificate PEM matching key ID r1.')
@secure()
param kasRsaCertificatePem string = ''

@description('Persistent P-256 PKCS#8 private key PEM; required only when deployApps=true.')
@secure()
param kasEcPrivatePem string = ''

@description('EC public certificate PEM matching key ID e1.')
@secure()
param kasEcCertificatePem string = ''

@description('Microsoft-recommended PostgreSQL public root CA bundle, generated with fingerprint verification.')
@secure()
param postgresqlRootCaPem string = ''

@description('Origin-specific OpenTDF YAML generated after foundation deployment. Never use an upstream wildcard-CORS example unchanged.')
@secure()
param platformConfigYaml string = ''

@description('Development/test cost and ownership tags.')
param tags object = {
  workload: 'opentdf-files'
  environment: 'devtest'
  dataClassification: 'synthetic-only'
  managedBy: 'bicep'
}

module foundation 'modules/foundation.bicep' = {
  name: '${namePrefix}-foundation'
  params: {
    location: location
    namePrefix: namePrefix
    databaseAdminLogin: databaseAdminLogin
    databaseAdminPassword: databaseAdminPassword
    tags: tags
  }
}

// The config is generated from these foundation-derived URLs between deployment stages.
// Neither URL depends on an app resource, avoiding app/config/hostname cycles.
var appUrl = 'https://${appName}.${foundation.outputs.environmentDefaultDomain}'
var platformUrl = 'https://${platformName}.${foundation.outputs.environmentDefaultDomain}'

module apps 'modules/apps.bicep' = if (deployApps) {
  name: '${namePrefix}-apps'
  params: {
    location: location
    appName: appName
    platformName: platformName
    revisionSuffix: revisionSuffix
    environmentId: foundation.outputs.environmentId
    appIdentityId: foundation.outputs.appIdentityId
    appIdentityClientId: foundation.outputs.appIdentityClientId
    platformIdentityId: foundation.outputs.platformIdentityId
    registryLoginServer: foundation.outputs.registryLoginServer
    storageAccountUrl: foundation.outputs.storageAccountUrl
    entraTenantId: entraTenantId
    entraSpaClientId: entraSpaClientId
    entraApiAudience: entraApiAudience
    opentdfAttribute: opentdfAttribute
    platformUrl: platformUrl
    appImage: appImage
    platformImage: platformImage
    databaseAdminPassword: databaseAdminPassword
    kasRsaPrivatePem: kasRsaPrivatePem
    kasRsaCertificatePem: kasRsaCertificatePem
    kasEcPrivatePem: kasEcPrivatePem
    kasEcCertificatePem: kasEcCertificatePem
    postgresqlRootCaPem: postgresqlRootCaPem
    platformConfigYaml: platformConfigYaml
    tags: tags
  }
}

output applicationUrl string = appUrl
output opentdfPlatformUrl string = platformUrl
output opentdfKasUrl string = '${platformUrl}/kas'
output appIdentityClientId string = foundation.outputs.appIdentityClientId
output appIdentityPrincipalId string = foundation.outputs.appIdentityPrincipalId
output platformIdentityPrincipalId string = foundation.outputs.platformIdentityPrincipalId
output registryId string = foundation.outputs.registryId
output registryName string = foundation.outputs.registryName
output registryLoginServer string = foundation.outputs.registryLoginServer
output storageAccountUrl string = foundation.outputs.storageAccountUrl
output environmentId string = foundation.outputs.environmentId
output virtualNetworkId string = foundation.outputs.virtualNetworkId
output deploymentSettings object = {
  namePrefix: namePrefix
  appName: appName
  platformName: platformName
  location: location
  databaseAdminLogin: databaseAdminLogin
  databaseHost: foundation.outputs.databaseHost
  databaseName: 'opentdf'
  environmentDefaultDomain: foundation.outputs.environmentDefaultDomain
}
