$ErrorActionPreference = 'Stop'
$ServiceDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ModelDir = Join-Path $ServiceDir 'models'
$OdeDir = Join-Path $ModelDir 'ode'
New-Item -ItemType Directory -Force -Path $OdeDir | Out-Null

if (-not $env:GRU_MODEL_SHA256) { $env:GRU_MODEL_SHA256 = 'db59d414b8b88a6ac1140dd5bbce40475878d97a6436fb087141e25bdb3887fe' }
if (-not $env:GRU_MODEL_URL) { $env:GRU_MODEL_URL = 'https://huggingface.co/doyeonkoo/runway-hr-gru/resolve/main/gru_final.pt' }
if (-not $env:ODEV21_CHECKPOINT_SHA256) { $env:ODEV21_CHECKPOINT_SHA256 = 'ba767a645c2b1180a3ced3cbcc533142544d3e34cc69b23aed28eba134b14061' }
if (-not $env:ODEV21_SUMMARY_STATS_SHA256) { $env:ODEV21_SUMMARY_STATS_SHA256 = '9251e04e3dc50ecb66cbd48faa7c6882b80f16a51af0746669cd5f0545b4e066' }
if (-not $env:ODEV21_SOURCE_CHECKPOINT) { throw 'Set ODEV21_SOURCE_CHECKPOINT to the ODE source checkpoint (model_epoch_020.pt)' }
if (-not $env:ODEV21_SOURCE_STATS) { throw 'Set ODEV21_SOURCE_STATS to the ODE source summary_stats.json' }

function Copy-Verified([string]$Source, [string]$Target, [string]$Expected) {
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Missing model source: $Source" }
    $Temp = "$Target.download"
    Copy-Item -LiteralPath $Source -Destination $Temp -Force
    $Actual = (Get-FileHash -LiteralPath $Temp -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($Actual -ne $Expected.ToLowerInvariant()) { Remove-Item -LiteralPath $Temp -Force; throw "SHA-256 mismatch: $Source" }
    Move-Item -LiteralPath $Temp -Destination $Target -Force
}

$GruTemp = Join-Path $ModelDir 'gru_final.pt.download'
Invoke-WebRequest -Uri $env:GRU_MODEL_URL -OutFile $GruTemp
$GruActual = (Get-FileHash -LiteralPath $GruTemp -Algorithm SHA256).Hash.ToLowerInvariant()
if ($GruActual -ne $env:GRU_MODEL_SHA256.ToLowerInvariant()) { Remove-Item -LiteralPath $GruTemp -Force; throw 'GRU SHA-256 mismatch' }
Move-Item -LiteralPath $GruTemp -Destination (Join-Path $ModelDir 'gru_final.pt') -Force
Copy-Verified $env:ODEV21_SOURCE_CHECKPOINT (Join-Path $OdeDir 'ode_epoch_020.pt') $env:ODEV21_CHECKPOINT_SHA256
Copy-Verified $env:ODEV21_SOURCE_STATS (Join-Path $OdeDir 'ode_summary_stats.json') $env:ODEV21_SUMMARY_STATS_SHA256
Write-Output "Model assets installed and verified in $ModelDir"
