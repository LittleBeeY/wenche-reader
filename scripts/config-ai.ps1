$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$EnvPath = Join-Path $ProjectRoot ".env"

Write-Host "Configure OpenAI-compatible AI provider"
Write-Host "Your API key will be saved to .env in this project folder."
Write-Host ""

function Normalize-BaseUrl {
  param([string]$Value)
  $trimmed = $Value.Trim()
  if (-not $trimmed) {
    return "https://api.deepseek.com"
  }
  if ($trimmed.StartsWith("//")) {
    return "https:$trimmed".TrimEnd("/")
  }
  if ($trimmed -notmatch "^https?://") {
    return "https://$trimmed".TrimEnd("/")
  }
  return $trimmed.TrimEnd("/")
}

$baseUrl = Read-Host "API base URL [https://api.deepseek.com]"
if (-not $baseUrl) {
  $baseUrl = "https://api.deepseek.com"
}
$baseUrl = Normalize-BaseUrl $baseUrl

$model = Read-Host "Model [deepseek-v4-flash]"
if (-not $model) {
  $model = "deepseek-v4-flash"
}

$secureApiKey = Read-Host "API key" -AsSecureString
$apiKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureApiKey)
try {
  $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($apiKeyPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($apiKeyPointer)
}
if (-not $apiKey) {
  Write-Host "API key is required. No changes were written."
  exit 1
}

$port = Read-Host "Port [3000]"
if (-not $port) {
  $port = "3000"
}

$content = @(
  "AI_PROVIDER=openai-compatible",
  "AI_API_KEY=$apiKey",
  "AI_API_BASE=$baseUrl",
  "AI_MODEL=$model",
  "PORT=$port",
  "HOST=127.0.0.1"
) -join [Environment]::NewLine

[System.IO.File]::WriteAllText($EnvPath, $content + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Saved AI configuration to $EnvPath"
Write-Host "Checking provider connection..."
try {
  $headers = @{ Authorization = "Bearer $apiKey" }
  $modelsResponse = Invoke-RestMethod -Uri "$baseUrl/models" -Headers $headers -Method Get -TimeoutSec 20
  $availableModels = @($modelsResponse.data | ForEach-Object { $_.id })
  if ($availableModels -contains $model) {
    Write-Host "Connection succeeded. Model '$model' is available."
  } else {
    Write-Warning "Connection succeeded, but model '$model' was not listed. Check the model name before use."
  }
} catch {
  Write-Warning "Configuration was saved, but the connection check failed: $($_.Exception.Message)"
}
$apiKey = $null
Write-Host "Run scripts\open-reader.cmd to start the app."
