#requires -Version 7.4
[CmdletBinding(DefaultParameterSetName = 'Generate')]
param(
    [Parameter(ParameterSetName = 'Generate')]
    [switch] $Generate,

    [Parameter(Mandatory, ParameterSetName = 'Configure')]
    [switch] $Configure,

    [Parameter(Mandatory, ParameterSetName = 'Configure')]
    [string] $ParametersPath,

    [Parameter(Mandatory, ParameterSetName = 'Configure')]
    [string] $FoundationOutputsPath,

    [Parameter(Mandatory, ParameterSetName = 'Configure')]
    [ValidatePattern('^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$')]
    [string] $AppImage,

    [Parameter(ParameterSetName = 'Configure')]
    [ValidatePattern('^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$')]
    [string] $PlatformImage = 'registry.opentdf.io/platform@sha256:5f0996865aefc46e30e35e219576906a648c15e217575f243a888a0ab842cbf0',

    [string] $OutputDirectory = '.secrets',

    [Parameter(ParameterSetName = 'Configure')]
    [ValidatePattern('^[a-zA-Z0-9_-]+\.local\.json$')]
    [string] $RuntimeFileName = 'runtime.local.json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$secretsRoot = Join-Path $projectRoot '.secrets'
if ([IO.Path]::IsPathRooted($OutputDirectory)) {
    throw 'OutputDirectory must be a project-relative path under .secrets.'
}
$outputPath = [IO.Path]::GetFullPath($OutputDirectory, $projectRoot)
$comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
if (-not ($outputPath.Equals($secretsRoot, $comparison) -or
        $outputPath.StartsWith($secretsRoot + [IO.Path]::DirectorySeparatorChar, $comparison))) {
    throw 'All generated material must remain under the project .secrets directory.'
}

function Assert-NoReparsePoint([string] $Path) {
    $current = $Path
    while (-not $current.Equals($projectRoot, $comparison)) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Secret paths must not contain symbolic links or junctions.'
            }
        }
        $current = Split-Path -Parent $current
    }
}

function Assert-Ignored([string] $Path) {
    $relative = [IO.Path]::GetRelativePath($projectRoot, $Path)
    & git -C $projectRoot check-ignore --quiet --no-index -- $relative
    if ($LASTEXITCODE -ne 0) {
        throw 'Secret output is not ignored by Git. Configure .secrets/ and *.local.json exclusions first.'
    }
}

function Protect-Directory([string] $Path) {
    if ($IsWindows) {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetAccessRuleProtection($true, $false)
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $identity, [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
        [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path), $acl)
    } else {
        [IO.File]::SetUnixFileMode($Path, [IO.UnixFileMode]'UserRead, UserWrite, UserExecute')
    }
}

function Write-NewFile([string] $Name, [string] $Content) {
    $path = Join-Path $outputPath $Name
    Assert-Ignored $path
    Assert-NoReparsePoint $path
    $stream = [IO.FileStream]::new($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        if (-not $IsWindows) {
            [IO.File]::SetUnixFileMode($path, [IO.UnixFileMode]'UserRead, UserWrite')
        }
        $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Content)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally {
        $stream.Dispose()
    }
}

function Read-Parameters([string] $Path) {
    $document = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
    if (-not $document.ContainsKey('parameters')) {
        throw 'Expected an ARM deployment parameters JSON document.'
    }
    return $document.parameters
}

function Get-ParameterValue([hashtable] $Parameters, [string] $Name, [string] $Default = '') {
    if ($Parameters.ContainsKey($Name)) {
        if (-not $Parameters[$Name].ContainsKey('value')) {
            throw "Parameter $Name must contain a local value, not an unresolved secret reference."
        }
        return [string] $Parameters[$Name].value
    }
    return $Default
}

function ConvertTo-ParameterDocument([hashtable] $Parameters) {
    return @{
        '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
        contentVersion = '1.0.0.0'
        parameters = $Parameters
    } | ConvertTo-Json -Depth 20
}

function Get-PostgresqlRoots {
    $roots = @(
        @{
            Uri = 'https://cacerts.digicert.com/DigiCertGlobalRootG2.crt'
            Sha256 = 'CB3CCBB76031E5E0138F8DD39A23F9DE47FFC35E43C1144CEA27D46A5AB1CB5F'
        },
        @{
            Uri = 'https://www.microsoft.com/pkiops/certs/Microsoft%20RSA%20Root%20Certificate%20Authority%202017.crt'
            Sha256 = 'C741F70F4B2A8D88BF2E71C14122EF53EF10EBA0CFA5E64CFA20F418853073E0'
        }
    )
    $certificates = foreach ($root in $roots) {
        $response = Invoke-WebRequest -Uri $root.Uri -TimeoutSec 30 -MaximumRedirection 0
        $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new([byte[]] $response.Content)
        try {
            if ($certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256) -ne $root.Sha256) {
                throw 'PostgreSQL root CA fingerprint changed. Review Microsoft guidance before updating pins.'
            }
            $certificate.ExportCertificatePem()
        } finally {
            $certificate.Dispose()
        }
    }
    return ($certificates -join "`n") + "`n"
}

Assert-NoReparsePoint $outputPath
Assert-Ignored (Join-Path $outputPath 'secrets.local.json')
if (-not (Test-Path -LiteralPath $outputPath)) {
    New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
}
Protect-Directory $outputPath

if ($PSCmdlet.ParameterSetName -eq 'Generate') {
    $names = @(
        'kas-private.pem', 'kas-cert.pem', 'kas-ec-private.pem', 'kas-ec-cert.pem',
        'postgresql-roots.pem', 'secrets.local.json'
    )
    foreach ($name in $names) {
        if (Test-Path -LiteralPath (Join-Path $outputPath $name)) {
            throw 'Existing secret or key material found. Refusing to replace historical keys or the database password.'
        }
    }

    $rootsPem = Get-PostgresqlRoots
    $rsa = [Security.Cryptography.RSA]::Create(2048)
    $ec = [Security.Cryptography.ECDsa]::Create([Security.Cryptography.ECCurve+NamedCurves]::nistP256)
    $rsaCertificate = $null
    $ecCertificate = $null
    try {
        $hash = [Security.Cryptography.HashAlgorithmName]::SHA256
        $rsaRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
            'CN=OpenTDF DEV KAS r1', $rsa, $hash, [Security.Cryptography.RSASignaturePadding]::Pkcs1
        )
        $ecRequest = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=OpenTDF DEV KAS e1', $ec, $hash)
        $notBefore = [DateTimeOffset]::UtcNow.AddMinutes(-5)
        $notAfter = $notBefore.AddYears(2)
        $rsaCertificate = $rsaRequest.CreateSelfSigned($notBefore, $notAfter)
        $ecCertificate = $ecRequest.CreateSelfSigned($notBefore, $notAfter)
        $rsaPrivatePem = $rsa.ExportPkcs8PrivateKeyPem() + "`n"
        $rsaCertificatePem = $rsaCertificate.ExportCertificatePem() + "`n"
        $ecPrivatePem = $ec.ExportPkcs8PrivateKeyPem() + "`n"
        $ecCertificatePem = $ecCertificate.ExportCertificatePem() + "`n"
        $password = 'Aa1!' + [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(36))
        $secrets = @{
            databaseAdminPassword = @{ value = $password }
            kasRsaPrivatePem = @{ value = $rsaPrivatePem }
            kasRsaCertificatePem = @{ value = $rsaCertificatePem }
            kasEcPrivatePem = @{ value = $ecPrivatePem }
            kasEcCertificatePem = @{ value = $ecCertificatePem }
            postgresqlRootCaPem = @{ value = $rootsPem }
        }
        Write-NewFile 'kas-private.pem' $rsaPrivatePem
        Write-NewFile 'kas-cert.pem' $rsaCertificatePem
        Write-NewFile 'kas-ec-private.pem' $ecPrivatePem
        Write-NewFile 'kas-ec-cert.pem' $ecCertificatePem
        Write-NewFile 'postgresql-roots.pem' $rootsPem
        Write-NewFile 'secrets.local.json' (ConvertTo-ParameterDocument $secrets)
    } finally {
        if ($null -ne $rsaCertificate) { $rsaCertificate.Dispose() }
        if ($null -ne $ecCertificate) { $ecCertificate.Dispose() }
        $rsa.Dispose()
        $ec.Dispose()
    }
    Write-Output "Created persistent development key material and secrets.local.json under $OutputDirectory. No secrets were printed."
    return
}

$runtimePath = Join-Path $outputPath $RuntimeFileName
if (Test-Path -LiteralPath $runtimePath) {
    throw 'Runtime parameter file exists. Choose another *.local.json name; existing material is never overwritten.'
}
$parameters = Read-Parameters $ParametersPath
$secrets = Read-Parameters (Join-Path $outputPath 'secrets.local.json')
foreach ($required in @('databaseAdminPassword', 'kasRsaPrivatePem', 'kasRsaCertificatePem',
        'kasEcPrivatePem', 'kasEcCertificatePem', 'postgresqlRootCaPem')) {
    if ([string]::IsNullOrWhiteSpace((Get-ParameterValue $secrets $required))) {
        throw "Persistent secret parameter $required is missing."
    }
}

$outputs = Get-Content -LiteralPath $FoundationOutputsPath -Raw | ConvertFrom-Json -AsHashtable
if (-not $outputs.ContainsKey('deploymentSettings')) {
    throw 'FoundationOutputsPath must contain properties.outputs from the stage-one deployment.'
}
$settings = $outputs.deploymentSettings.value
foreach ($name in @('namePrefix', 'appName', 'platformName', 'location', 'databaseAdminLogin')) {
    $expected = [string] $settings[$name]
    $provided = Get-ParameterValue $parameters $name $expected
    if ($provided -cne $expected) {
        throw "Parameter $name changed since foundation deployment. Keep both stages consistent."
    }
    $parameters[$name] = @{ value = $expected }
}
foreach ($name in @('entraTenantId', 'entraSpaClientId', 'entraApiAudience')) {
    $guid = [Guid]::Empty
    if (-not [Guid]::TryParseExact((Get-ParameterValue $parameters $name), 'D', [ref] $guid) -or $guid -eq [Guid]::Empty) {
        throw "Parameter $name must be a nonempty GUID."
    }
}

$applicationUrl = [string] $outputs.applicationUrl.value
$platformUrl = [string] $outputs.opentdfPlatformUrl.value
$expectedAppUrl = "https://$($settings.appName).$($settings.environmentDefaultDomain)"
$expectedPlatformUrl = "https://$($settings.platformName).$($settings.environmentDefaultDomain)"
if ($applicationUrl -cne $expectedAppUrl -or $platformUrl -cne $expectedPlatformUrl) {
    throw 'Foundation URL outputs do not match the stable Container Apps names and environment domain.'
}
foreach ($url in @($applicationUrl, $platformUrl)) {
    if ($url -notmatch '^https://[a-z0-9.-]+\.azurecontainerapps\.io$') {
        throw 'Expected an Azure Commercial Container Apps HTTPS origin without a path.'
    }
}
if ([string] $settings.databaseHost -notmatch '^[a-z0-9.-]+\.postgres\.database\.azure\.com$') {
    throw 'Unexpected PostgreSQL host in foundation outputs.'
}
if ([string] $settings.databaseAdminLogin -notmatch '^[a-zA-Z][a-zA-Z0-9_]{0,62}$') {
    throw 'Unexpected PostgreSQL login in foundation outputs.'
}
$registry = [string] $outputs.registryLoginServer.value
if (-not $AppImage.StartsWith("$registry/", [StringComparison]::Ordinal)) {
    throw 'The application image must be pushed to the private ACR created by this foundation.'
}
if (-not ($PlatformImage.StartsWith("$registry/", [StringComparison]::Ordinal) -or
        $PlatformImage.StartsWith('registry.opentdf.io/platform@sha256:', [StringComparison]::Ordinal))) {
    throw 'Platform image must use the upstream platform repository or this foundation ACR.'
}

$tenant = Get-ParameterValue $parameters 'entraTenantId'
$audience = Get-ParameterValue $parameters 'entraApiAudience'
$platformHost = ([Uri] $platformUrl).Host
$yaml = @"
mode:
  - all
dev_mode: false
logger:
  level: info
  type: json
  output: stdout
db:
  host: "$($settings.databaseHost)"
  port: 5432
  database: opentdf
  user: "$($settings.databaseAdminLogin)"
  password: ""
  sslmode: verify-full
  runMigrations: true
  connect_timeout_seconds: 15
services:
  entityresolution:
    mode: claims
  authorization:
    entitlement_policy_cache:
      enabled: false
  kas:
    key_management: false
    rsacertid: r1
    eccertid: e1
server:
  host: 0.0.0.0
  port: 8080
  public_hostname: "$platformHost"
  tls:
    enabled: false
  auth:
    enabled: true
    issuer: "https://login.microsoftonline.com/$tenant/v2.0"
    audience: "$audience"
    dpop:
      enforce: false
    policy:
      groups_claim: roles
      username_claim: sub
      client_id_claim: azp
      extension: |
        g, Files.User, role:standard
        g, Platform.Admin, role:admin
  cors:
    enabled: true
    allowedorigins:
      - "$applicationUrl"
    allowedmethods:
      - GET
      - POST
      - OPTIONS
    allowedheaders:
      - Accept
      - Accept-Encoding
      - Authorization
      - Connect-Protocol-Version
      - Connect-Timeout-Ms
      - Content-Length
      - Content-Type
      - Dpop
      - X-CSRF-Token
      - X-Requested-With
      - X-Rewrap-Additional-Context
      - X-VirtruPubKey
      - X-Virtru-Client
      - X-Virtru-Version
    exposedheaders:
      - Link
      - Grpc-Status
      - Grpc-Message
      - Grpc-Status-Details-Bin
    allowcredentials: false
    maxage: 600
  cryptoProvider:
    type: standard
    standard:
      keys:
        - kid: r1
          alg: rsa:2048
          private: /keys/kas-private.pem
          cert: /keys/kas-cert.pem
        - kid: e1
          alg: ec:secp256r1
          private: /keys/kas-ec-private.pem
          cert: /keys/kas-ec-cert.pem
"@

foreach ($name in $secrets.Keys) {
    $parameters[$name] = $secrets[$name]
}
$parameters.deployApps = @{ value = $true }
$parameters.revisionSuffix = @{
    value = 'r-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6)
}
$parameters.appImage = @{ value = $AppImage }
$parameters.platformImage = @{ value = $PlatformImage }
$parameters.platformConfigYaml = @{ value = $yaml + "`n" }
Write-NewFile $RuntimeFileName (ConvertTo-ParameterDocument $parameters)
Write-Output "Created $OutputDirectory\$RuntimeFileName using the existing keys/password. No secrets were printed."
