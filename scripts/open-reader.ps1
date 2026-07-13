$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $ProjectRoot

function Read-DotEnv {
  param([string]$Path)
  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content -Path $Path -Encoding UTF8) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $index = $trimmed.IndexOf("=")
    if ($index -lt 0) {
      continue
    }

    $key = $trimmed.Substring(0, $index).Trim()
    $value = $trimmed.Substring($index + 1).Trim().Trim('"').Trim("'")
    if ($key) {
      $values[$key] = $value
    }
  }

  return $values
}

$envValues = Read-DotEnv (Join-Path $ProjectRoot ".env")
$port = if ($env:PORT) { $env:PORT } elseif ($envValues.PORT) { $envValues.PORT } else { "3000" }
$url = "http://localhost:$port"

if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
  Write-Host "Installing dependencies..."
  npm.cmd install
}

$isRunning = $false
try {
  Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null
  $isRunning = $true
} catch {
  $isRunning = $false
}

if (-not $isRunning) {
  Write-Host "Starting AI Deep Reader at $url"
  cmd.exe /c start "AI Deep Reader Server" cmd.exe /k "cd /d `"$ProjectRoot`" && npm.cmd start"
  Start-Sleep -Seconds 2
}

cmd.exe /c start "" "$url"
Write-Host "Opened $url"
