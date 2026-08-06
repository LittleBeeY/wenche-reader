$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$EnvPath = Join-Path $ProjectRoot ".env"

Write-Host "Configure AI provider"
Write-Host "Your API key will be saved to .env in this project folder."
Write-Host ""

function Normalize-BaseUrl {
  param([string]$Value)
  $trimmed = $Value.Trim()
  if (-not $trimmed) {
    return ""
  }
  if ($trimmed.StartsWith("//")) {
    return "https:$trimmed".TrimEnd("/")
  }
  if ($trimmed -notmatch "^https?://") {
    if ($trimmed -match "^(127\.0\.0\.1|localhost)(:|/)") {
      return "http://$trimmed".TrimEnd("/")
    }
    return "https://$trimmed".TrimEnd("/")
  }
  return $trimmed.TrimEnd("/")
}

# 注意：此表是 src/lib/aiProvider.js 中 PROVIDER_PRESETS 的镜像（仅为命令行兜底）。
# 新增/修改 provider 时务必两处同步，否则应用内设置与脚本结果会不一致。
$providers = @(
  @{ Key = "deepseek"; Name = "DeepSeek"; Type = "openai-compatible"; Base = "https://api.deepseek.com"; Model = "deepseek-v4-flash"; RequiresKey = $true },
  @{ Key = "openai"; Name = "OpenAI"; Type = "openai-compatible"; Base = "https://api.openai.com/v1"; Model = "gpt-4.1-mini"; RequiresKey = $true },
  @{ Key = "kimi"; Name = "Moonshot Kimi"; Type = "openai-compatible"; Base = "https://api.moonshot.cn/v1"; Model = "moonshot-v1-8k"; RequiresKey = $true },
  @{ Key = "zhipu"; Name = "Zhipu GLM"; Type = "openai-compatible"; Base = "https://open.bigmodel.cn/api/paas/v4"; Model = "glm-4-flash"; RequiresKey = $true },
  @{ Key = "qwen"; Name = "Qwen (Alibaba)"; Type = "openai-compatible"; Base = "https://dashscope.aliyuncs.com/compatible-mode/v1"; Model = "qwen-plus"; RequiresKey = $true },
  @{ Key = "ollama"; Name = "Ollama (local)"; Type = "openai-compatible"; Base = "http://127.0.0.1:11434/v1"; Model = ""; RequiresKey = $false },
  @{ Key = "anthropic"; Name = "Anthropic Claude"; Type = "anthropic"; Base = "https://api.anthropic.com"; Model = "claude-sonnet-4-20250514"; RequiresKey = $true },
  @{ Key = "gemini"; Name = "Google Gemini"; Type = "gemini"; Base = "https://generativelanguage.googleapis.com"; Model = "gemini-2.0-flash"; RequiresKey = $true },
  @{ Key = "custom"; Name = "Custom OpenAI-compatible"; Type = "openai-compatible"; Base = ""; Model = ""; RequiresKey = $true }
)

Write-Host "Select an AI provider:"
for ($i = 0; $i -lt $providers.Count; $i++) {
  $provider = $providers[$i]
  Write-Host ("  {0}) {1}" -f ($i + 1), $provider.Name)
}
Write-Host "  0) Quit (do not write config)"

$selection = Read-Host "Provider"
$selectedIndex = 0
if (-not [int]::TryParse($selection, [ref]$selectedIndex) -or $selectedIndex -lt 1 -or $selectedIndex -gt $providers.Count) {
  Write-Host "No provider selected. No changes were written."
  exit 0
}
$provider = $providers[$selectedIndex - 1]

Write-Host ""
Write-Host ("Selected: {0}" -f $provider.Name)

$baseUrl = $provider.Base
if (-not $provider.Base) {
  $prompt = "API base URL (OpenAI-compatible root, e.g. https://api.deepseek.com)"
  $baseUrl = Read-Host $prompt
  $baseUrl = Normalize-BaseUrl $baseUrl
  if (-not $baseUrl) {
    Write-Host "API base URL is required. No changes were written."
    exit 1
  }
} else {
  $input = Read-Host ("API base URL [{0}]" -f $provider.Base)
  if ($input) {
    $baseUrl = Normalize-BaseUrl $input
  }
}

$model = $provider.Model
if (-not $provider.Model) {
  $model = Read-Host "Model (e.g. llama3.1; use the name you pulled locally)"
  if (-not $model) {
    Write-Host "Model is required. No changes were written."
    exit 1
  }
} else {
  $input = Read-Host ("Model [{0}]" -f $provider.Model)
  if ($input) {
    $model = $input
  }
}

$apiKey = ""
if ($provider.RequiresKey) {
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
} else {
  $apiKey = Read-Host "API key (optional for local services)"
}

$port = Read-Host "Port [3000]"
if (-not $port) {
  $port = "3000"
}

$content = @(
  "AI_PROVIDER=$($provider.Key)",
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

function Test-ProviderConnection {
  param(
    [Parameter(Mandatory = $true)]$Provider,
    [Parameter(Mandatory = $true)][string]$BaseUrl,
    [string]$ApiKey,
    [string]$Model
  )
  try {
    $uri = ""
    $headers = @{}
    switch ($Provider.Type) {
      "anthropic" {
        $root = $BaseUrl.TrimEnd("/") -replace "/v1$", ""
        $uri = "$root/v1/models"
        $headers = @{ "x-api-key" = $ApiKey; "anthropic-version" = "2023-06-01" }
      }
      "gemini" {
        $root = $BaseUrl.TrimEnd("/") -replace "/v1beta$", ""
        $uri = "$root/v1beta/models"
        $headers = @{ "x-goog-api-key" = $ApiKey }
      }
      default {
        if ($BaseUrl -match "^(http://)(127\.0\.0\.1|localhost):11434") {
          $root = $BaseUrl.TrimEnd("/") -replace "/v1$", ""
          $uri = "$root/api/tags"
        } else {
          $uri = "$BaseUrl/models"
          if ($ApiKey) {
            $headers = @{ Authorization = "Bearer $ApiKey" }
          }
        }
      }
    }

    $response = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get -TimeoutSec 20
    $availableModels = @($response.data | ForEach-Object { $_.id })
    if ($availableModels.Count -gt 0) {
      if ($Model -and ($availableModels -contains $Model)) {
        Write-Host "Connection succeeded. Model '$Model' is available."
      } elseif ($Model) {
        Write-Warning "Connection succeeded, but model '$Model' was not listed. Check the model name before use."
      } else {
        Write-Host "Connection succeeded."
      }
    } else {
      Write-Host "Connection succeeded."
    }
  } catch {
    Write-Warning "Configuration was saved, but the connection check failed: $($_.Exception.Message)"
  }
}

Test-ProviderConnection -Provider $provider -BaseUrl $baseUrl -ApiKey $apiKey -Model $model
$apiKey = $null
Write-Host "Run scripts\open-reader.cmd to start the app."
