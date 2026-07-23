$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtimeRoot = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$nodeExe = Join-Path $runtimeRoot "node\bin\node.exe"
$pnpmExe = Join-Path $runtimeRoot "bin\fallback\pnpm.cmd"

if (-not (Test-Path -LiteralPath $nodeExe) -or -not (Test-Path -LiteralPath $pnpmExe)) {
  throw "Die lokale Codex-Laufzeit wurde nicht gefunden. Bitte das Inseratestudio aus Codex starten."
}

$env:PATH = "$(Split-Path $nodeExe);$(Split-Path $pnpmExe);$env:PATH"

if (-not (Test-Path -LiteralPath (Join-Path $appRoot "node_modules"))) {
  Push-Location $appRoot
  try {
    & $pnpmExe install --frozen-lockfile
  } finally {
    Pop-Location
  }
}

$workRoot = Join-Path $appRoot "work"
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
$dataRoot = Join-Path $env:LOCALAPPDATA "Fabian-Pascal Inseratestudio"
$sessionFile = Join-Path $dataRoot "helper-session"
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
if (-not (Test-Path -LiteralPath $sessionFile)) {
  $sessionToken = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  [IO.File]::WriteAllText($sessionFile, $sessionToken)
} else {
  $sessionToken = [IO.File]::ReadAllText($sessionFile).Trim()
}
$env:FPI_SESSION_TOKEN = $sessionToken
$sessionHeaders = @{ "X-FPI-Session" = $sessionToken }

$helperPort = Get-NetTCPConnection -LocalPort 43182 -State Listen -ErrorAction SilentlyContinue
if (-not $helperPort) {
  Start-Process -FilePath $nodeExe -ArgumentList @("local-upload-server.mjs") -WorkingDirectory $appRoot -RedirectStandardOutput (Join-Path $workRoot "helper.out.log") -RedirectStandardError (Join-Path $workRoot "helper.err.log") -WindowStyle Hidden
} else {
  try {
    $helper = Invoke-RestMethod -Uri "http://127.0.0.1:43182/health" -Headers $sessionHeaders -TimeoutSec 2
    if ($helper.service -ne "fabian-pascal-helper") { throw "Fremder Dienst" }
  } catch {
    throw "Port 43182 wird bereits von einem anderen Programm verwendet."
  }
}

$studioPort = Get-NetTCPConnection -LocalPort 43181 -State Listen -ErrorAction SilentlyContinue
if (-not $studioPort) {
  Start-Process -FilePath $pnpmExe -ArgumentList @("run", "dev") -WorkingDirectory $appRoot -RedirectStandardOutput (Join-Path $workRoot "studio.out.log") -RedirectStandardError (Join-Path $workRoot "studio.err.log") -WindowStyle Hidden
} else {
  try {
    $studioPage = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:43181" -TimeoutSec 2
    if ($studioPage.Content -notmatch "Fabian(&|&amp;)Pascal Inseratestudio") { throw "Fremder Dienst" }
  } catch {
    throw "Port 43181 wird bereits von einem anderen Programm verwendet."
  }
}

Start-Sleep -Seconds 3
Start-Process "http://localhost:43181/#session=$sessionToken"
