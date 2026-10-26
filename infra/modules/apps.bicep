@description('Container App region, matching its environment.')
param location string

@description('Stable browser/API Container App name.')
param appName string

@description('Stable OpenTDF Container App name.')
param platformName string

@description('Nonsecret release identifier; reuse the same parameter file for an idempotent deployment.')
@minLength(3)
@maxLength(32)
param revisionSuffix string

@description('Foundation environment resource ID.')
param environmentId string

@description('Application user-assigned identity resource ID.')
param appIdentityId string

@description('Application user-assigned identity client ID for DefaultAzureCredential.')
param appIdentityClientId string

@description('Platform image-pull-only identity resource ID.')
param platformIdentityId string

@description('Foundation private ACR login server.')
param registryLoginServer string

@description('Private Blob Storage account HTTPS URL.')
param storageAccountUrl string

@description('Tenant-specific Entra directory GUID.')
@minLength(36)
@maxLength(36)
param entraTenantId string

@description('Public SPA client-ID GUID.')
@minLength(36)
@maxLength(36)
param entraSpaClientId string

@description('API resource client-ID GUID, not api:// URI or Microsoft Graph.')
@minLength(36)
@maxLength(36)
param entraApiAudience string

@description('Configured policy attribute FQN.')
@minLength(1)
param opentdfAttribute string

@description('Public HTTPS platform URL derived from the foundation default domain.')
@minLength(1)
param platformUrl string

@description('Operator-built application repository@sha256:digest reference.')
@minLength(71)
param appImage string

@description('Pinned OpenTDF repository@sha256:digest reference.')
@minLength(71)
param platformImage string

@description('PostgreSQL password, exposed to OpenTDF only as a secret-backed environment variable.')
@secure()
@minLength(16)
param databaseAdminPassword string

@description('Persistent RSA PKCS#8 private key.')
@secure()
@minLength(1)
param kasRsaPrivatePem string

@description('Persistent RSA certificate.')
@secure()
@minLength(1)
param kasRsaCertificatePem string

@description('Persistent P-256 PKCS#8 private key.')
@secure()
@minLength(1)
param kasEcPrivatePem string

@description('Persistent P-256 certificate.')
@secure()
@minLength(1)
param kasEcCertificatePem string

@description('Public PostgreSQL root CA bundle mounted for Go/pgx hostname and chain verification.')
@secure()
@minLength(1)
param postgresqlRootCaPem string

@description('Complete origin-specific OpenTDF configuration, generated after foundation deployment.')
@secure()
@minLength(1)
param platformConfigYaml string

@description('Cost and ownership tags.')
param tags object

// Indexing the digest component rejects mutable tag-only references at ARM evaluation time.
var immutableAppImage = '${split(appImage, '@sha256:')[0]}@sha256:${split(appImage, '@sha256:')[1]}'
var immutablePlatformImage = '${split(platformImage, '@sha256:')[0]}@sha256:${split(platformImage, '@sha256:')[1]}'

resource platform 'Microsoft.App/containerApps@2025-01-01' = {
  name: platformName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${platformIdentityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 2
      identitySettings: [
        {
          identity: platformIdentityId
          lifecycle: 'None'
        }
      ]
      registries: [
        {
          server: registryLoginServer
          identity: platformIdentityId
        }
      ]
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http2'
        allowInsecure: false
      }
      secrets: [
        {
          name: 'database-password'
          value: databaseAdminPassword
        }
        {
          name: 'kas-rsa-private'
          value: kasRsaPrivatePem
        }
        {
          name: 'kas-rsa-certificate'
          value: kasRsaCertificatePem
        }
        {
          name: 'kas-ec-private'
          value: kasEcPrivatePem
        }
        {
          name: 'kas-ec-certificate'
          value: kasEcCertificatePem
        }
        {
          name: 'postgresql-roots'
          value: postgresqlRootCaPem
        }
        {
          name: 'platform-config'
          value: platformConfigYaml
        }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix
      terminationGracePeriodSeconds: 30
      containers: [
        {
          name: 'platform'
          image: immutablePlatformImage
          command: [
            '/usr/bin/opentdf'
          ]
          args: [
            'start'
            '--config-file'
            '/etc/opentdf/opentdf.yaml'
          ]
          env: [
            {
              name: 'OPENTDF_DB_PASSWORD'
              secretRef: 'database-password'
            }
            {
              name: 'PGSSLROOTCERT'
              value: '/etc/opentdf-roots/postgresql-roots.pem'
            }
          ]
          resources: {
            cpu: 1
            memory: '2Gi'
          }
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/healthz'
                port: 8080
              }
              periodSeconds: 20
              timeoutSeconds: 5
              failureThreshold: 10
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/healthz'
                port: 8080
              }
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/healthz?service=all'
                port: 8080
              }
              periodSeconds: 10
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
          volumeMounts: [
            {
              volumeName: 'platform-config'
              mountPath: '/etc/opentdf'
            }
            {
              volumeName: 'kas-keys'
              mountPath: '/keys'
            }
            {
              volumeName: 'postgresql-roots'
              mountPath: '/etc/opentdf-roots'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'platform-config'
          storageType: 'Secret'
          secrets: [
            {
              secretRef: 'platform-config'
              path: 'opentdf.yaml'
            }
          ]
        }
        {
          name: 'kas-keys'
          storageType: 'Secret'
          secrets: [
            {
              secretRef: 'kas-rsa-private'
              path: 'kas-private.pem'
            }
            {
              secretRef: 'kas-rsa-certificate'
              path: 'kas-cert.pem'
            }
            {
              secretRef: 'kas-ec-private'
              path: 'kas-ec-private.pem'
            }
            {
              secretRef: 'kas-ec-certificate'
              path: 'kas-ec-cert.pem'
            }
          ]
        }
        {
          name: 'postgresql-roots'
          storageType: 'Secret'
          secrets: [
            {
              secretRef: 'postgresql-roots'
              path: 'postgresql-roots.pem'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2025-01-01' = {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentityId}': {}
    }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 2
      registries: [
        {
          server: registryLoginServer
          identity: appIdentityId
        }
      ]
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: false
      }
    }
    template: {
      revisionSuffix: revisionSuffix
      terminationGracePeriodSeconds: 30
      containers: [
        {
          name: 'files'
          image: immutableAppImage
          resources: {
            cpu: 1
            memory: '2Gi'
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'ENTRA_TENANT_ID'
              value: entraTenantId
            }
            {
              name: 'ENTRA_SPA_CLIENT_ID'
              value: entraSpaClientId
            }
            {
              name: 'ENTRA_API_AUDIENCE'
              value: entraApiAudience
            }
            {
              name: 'OPENTDF_PLATFORM_URL'
              value: platformUrl
            }
            {
              name: 'OPENTDF_KAS_URL'
              value: '${platformUrl}/kas'
            }
            {
              name: 'OPENTDF_ATTRIBUTE'
              value: opentdfAttribute
            }
            {
              name: 'AZURE_STORAGE_ACCOUNT_URL'
              value: storageAccountUrl
            }
            {
              name: 'AZURE_STORAGE_CONTAINER'
              value: 'files'
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: appIdentityClientId
            }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/'
                port: 3000
              }
              periodSeconds: 10
              failureThreshold: 10
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/'
                port: 3000
              }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/'
                port: 3000
              }
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}
