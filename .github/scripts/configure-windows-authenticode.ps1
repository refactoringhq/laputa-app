param(
  [string]$ConfigPath = "src-tauri/tauri.windows-signing.conf.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-FirstEnv {
  param([string[]]$Names)

  foreach ($Name in $Names) {
    $Value = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($Value)) {
      return $Value.Trim()
    }
  }

  throw "Set one of these environment variables: $($Names -join ', ')"
}

function Read-OptionalEnv {
  param(
    [string[]]$Names,
    [string]$DefaultValue
  )

  foreach ($Name in $Names) {
    $Value = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($Value)) {
      return $Value.Trim()
    }
  }

  return $DefaultValue
}

function Normalize-Thumbprint {
  param([string]$Thumbprint)

  return ($Thumbprint -replace "\s", "").ToUpperInvariant()
}

function Convert-CertificateSecretToBytes {
  param([string]$CertificateSecret)

  $Base64Lines = $CertificateSecret -split "\r?\n" |
    Where-Object { $_ -notmatch "^-+BEGIN " -and $_ -notmatch "^-+END " }
  $CertificateBase64 = ($Base64Lines -join "") -replace "\s", ""

  try {
    return [Convert]::FromBase64String($CertificateBase64)
  } catch {
    throw "Windows code-signing certificate must be base64-encoded PFX data."
  }
}

$CertificateSecret = Read-FirstEnv @("WINDOWS_CODE_SIGNING_CERTIFICATE", "WINDOWS_CERTIFICATE")
$CertificatePassword = Read-FirstEnv @("WINDOWS_CODE_SIGNING_CERTIFICATE_PASSWORD", "WINDOWS_CERTIFICATE_PASSWORD")
$ConfiguredThumbprint = Read-OptionalEnv @("WINDOWS_CODE_SIGNING_CERTIFICATE_THUMBPRINT", "WINDOWS_CERTIFICATE_THUMBPRINT") ""
$DigestAlgorithm = Read-OptionalEnv @("WINDOWS_CODE_SIGNING_DIGEST_ALGORITHM") "sha256"
$TimestampUrl = Read-OptionalEnv @("WINDOWS_CODE_SIGNING_TIMESTAMP_URL", "WINDOWS_TIMESTAMP_URL") "http://timestamp.digicert.com"

$TempRoot = Join-Path ([IO.Path]::GetTempPath()) "tolaria-windows-signing"
if (-not [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  $TempRoot = Join-Path $env:RUNNER_TEMP "tolaria-windows-signing"
}
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null

$PfxPath = Join-Path $TempRoot "certificate.pfx"
[IO.File]::WriteAllBytes($PfxPath, (Convert-CertificateSecretToBytes $CertificateSecret))

$SecurePassword = [Security.SecureString]::new()
foreach ($Character in $CertificatePassword.ToCharArray()) {
  $SecurePassword.AppendChar($Character)
}
$SecurePassword.MakeReadOnly()
$ImportedCertificates = @(Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation Cert:\CurrentUser\My -Password $SecurePassword)
Remove-Item -Force -ErrorAction SilentlyContinue $PfxPath

$ImportedCertificate = $ImportedCertificates | Where-Object { $_.HasPrivateKey } | Select-Object -First 1
if ($null -eq $ImportedCertificate) {
  throw "The imported Windows code-signing certificate does not include a private key."
}

if ([string]::IsNullOrWhiteSpace($ConfiguredThumbprint)) {
  $CertificateThumbprint = Normalize-Thumbprint $ImportedCertificate.Thumbprint
} else {
  $CertificateThumbprint = Normalize-Thumbprint $ConfiguredThumbprint
}

$StoreCertificate = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { (Normalize-Thumbprint $_.Thumbprint) -eq $CertificateThumbprint } |
  Select-Object -First 1
if ($null -eq $StoreCertificate) {
  throw "The requested Windows code-signing certificate thumbprint was not found in Cert:\CurrentUser\My."
}

$Config = @{
  bundle = @{
    windows = @{
      certificateThumbprint = $CertificateThumbprint
      digestAlgorithm = $DigestAlgorithm
      timestampUrl = $TimestampUrl
    }
  }
}

$ResolvedConfigPath = Resolve-Path -Path (Split-Path -Parent $ConfigPath) -ErrorAction SilentlyContinue
if ($null -eq $ResolvedConfigPath) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
}

$Config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding utf8NoBOM

if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_ENV)) {
  "WINDOWS_CODE_SIGNING_CERTIFICATE_THUMBPRINT=$CertificateThumbprint" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
}

Write-Output "Prepared Windows Authenticode signing config at $ConfigPath."
