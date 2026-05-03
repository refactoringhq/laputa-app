$ErrorActionPreference = "Stop"

$nsisUrl = "https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip"
$nsisSha1 = "EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D"
$tauriUtilsUrl = "https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll"
$tauriUtilsSha1 = "75197FEE3C6A814FE035788D1C34EAD39349B860"
$tauriUtilsRelativePath = "Plugins\x86-unicode\additional\nsis_tauri_utils.dll"

$nsisRequiredFiles = @(
  "makensis.exe",
  "Bin\makensis.exe",
  "Stubs\lzma-x86-unicode",
  "Stubs\lzma_solid-x86-unicode",
  "Include\MUI2.nsh",
  "Include\FileFunc.nsh",
  "Include\x64.nsh",
  "Include\nsDialogs.nsh",
  "Include\WinMessages.nsh",
  "Include\Win\COM.nsh",
  "Include\Win\Propkey.nsh",
  "Include\Win\RestartManager.nsh"
)

function Get-UpperSha1 {
  param([Parameter(Mandatory = $true)][string]$Path)

  return (Get-FileHash -Algorithm SHA1 -LiteralPath $Path).Hash.ToUpperInvariant()
}

function Test-FileSha1 {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedSha1
  )

  return (Test-Path -LiteralPath $Path) -and ((Get-UpperSha1 -Path $Path) -eq $ExpectedSha1)
}

function Save-VerifiedDownload {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$OutFile,
    [Parameter(Mandatory = $true)][string]$ExpectedSha1
  )

  $parent = Split-Path -Parent $OutFile
  New-Item -ItemType Directory -Force -Path $parent | Out-Null

  $tempFile = "$OutFile.download"
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $tempFile
      Invoke-WebRequest -Uri $Uri -OutFile $tempFile -TimeoutSec 120

      $actualSha1 = Get-UpperSha1 -Path $tempFile
      if ($actualSha1 -ne $ExpectedSha1) {
        throw "SHA1 mismatch for $Uri. Expected $ExpectedSha1, got $actualSha1."
      }

      Move-Item -Force -LiteralPath $tempFile -Destination $OutFile
      return
    } catch {
      Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $tempFile
      if ($attempt -eq 5) {
        throw
      }

      $delaySeconds = [Math]::Min(30, 5 * $attempt)
      Write-Warning "Download attempt ${attempt} failed: $($_.Exception.Message). Retrying in ${delaySeconds}s."
      Start-Sleep -Seconds $delaySeconds
    }
  }
}

function Find-MissingFile {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string[]]$RelativePaths
  )

  foreach ($relativePath in $RelativePaths) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $relativePath))) {
      return $relativePath
    }
  }

  return $null
}

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  throw "LOCALAPPDATA is required to resolve Tauri's Windows tool cache."
}

$tauriToolsPath = Join-Path $env:LOCALAPPDATA "tauri"
$nsisPath = Join-Path $tauriToolsPath "NSIS"
$downloadRoot = if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
  [System.IO.Path]::GetTempPath()
} else {
  $env:RUNNER_TEMP
}

New-Item -ItemType Directory -Force -Path $tauriToolsPath | Out-Null

$missingNsisFile = Find-MissingFile -Root $nsisPath -RelativePaths $nsisRequiredFiles
if ($missingNsisFile) {
  Write-Host "Tauri NSIS cache is missing $missingNsisFile; downloading NSIS 3.11."
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $nsisPath
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath (Join-Path $tauriToolsPath "nsis-3.11")

  $zipPath = Join-Path $downloadRoot "nsis-3.11.zip"
  Save-VerifiedDownload -Uri $nsisUrl -OutFile $zipPath -ExpectedSha1 $nsisSha1
  Expand-Archive -Force -LiteralPath $zipPath -DestinationPath $tauriToolsPath

  $extractedNsisPath = Join-Path $tauriToolsPath "nsis-3.11"
  if (-not (Test-Path -LiteralPath $extractedNsisPath)) {
    throw "Downloaded NSIS archive did not contain the expected nsis-3.11 directory."
  }

  Move-Item -Force -LiteralPath $extractedNsisPath -Destination $nsisPath
} else {
  Write-Host "Tauri NSIS cache already contains NSIS 3.11."
}

$tauriUtilsPath = Join-Path $nsisPath $tauriUtilsRelativePath
if (-not (Test-FileSha1 -Path $tauriUtilsPath -ExpectedSha1 $tauriUtilsSha1)) {
  Write-Host "Downloading Tauri NSIS utility plugin."
  Save-VerifiedDownload -Uri $tauriUtilsUrl -OutFile $tauriUtilsPath -ExpectedSha1 $tauriUtilsSha1
} else {
  Write-Host "Tauri NSIS utility plugin is already cached."
}

$missingFile = Find-MissingFile -Root $nsisPath -RelativePaths ($nsisRequiredFiles + @($tauriUtilsRelativePath))
if ($missingFile) {
  throw "Tauri NSIS toolchain is incomplete after prefetch; missing $missingFile."
}

Write-Host "Tauri NSIS toolchain ready at $nsisPath."
