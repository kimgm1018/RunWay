$ErrorActionPreference = 'Stop'

$SourceMode = if ([string]::IsNullOrWhiteSpace($env:ODEV21_SOURCE_MODE)) { 'hf' } else { $env:ODEV21_SOURCE_MODE.Trim().ToLowerInvariant() }
if ($SourceMode -notin @('hf', 'local')) { throw 'ODEV21_SOURCE_MODE must be hf or local' }
if ($SourceMode -eq 'hf' -and [string]::IsNullOrWhiteSpace($env:HF_TOKEN)) {
    throw 'HF_TOKEN is required to download private model assets from Hugging Face'
}
if ($SourceMode -eq 'local') {
    foreach ($Name in @('ODEV21_SOURCE_CHECKPOINT', 'ODEV21_SOURCE_STATS', 'ODEV21_POPULATION_BUNDLE_SOURCE')) {
        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name))) {
            throw "Set $Name to the local ODE model source"
        }
    }
}

$ServiceDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$ModelDir = Join-Path $ServiceDir 'models'
$OdeDir = Join-Path $ModelDir 'ode'
$Repo = if ([string]::IsNullOrWhiteSpace($env:RUNWAY_MODEL_HF_REPO)) { 'AnSeongYun/runway-hr-models' } else { $env:RUNWAY_MODEL_HF_REPO.Trim() }
$Revision = if ([string]::IsNullOrWhiteSpace($env:RUNWAY_MODEL_HF_REVISION)) { 'e44028f7a5cebbed1070094f8e2a081a03c1f523' } else { $env:RUNWAY_MODEL_HF_REVISION.Trim() }
$GruSha = if ([string]::IsNullOrWhiteSpace($env:GRU_MODEL_SHA256)) { 'db59d414b8b88a6ac1140dd5bbce40475878d97a6436fb087141e25bdb3887fe' } else { $env:GRU_MODEL_SHA256 }
$CheckpointSha = if ([string]::IsNullOrWhiteSpace($env:ODEV21_CHECKPOINT_SHA256)) { '737334a7d77a8481f0f22029cf24dd20310f6620766c65ca7f452083450dee3b' } else { $env:ODEV21_CHECKPOINT_SHA256 }
$StatsSha = if ([string]::IsNullOrWhiteSpace($env:ODEV21_SUMMARY_STATS_SHA256)) { '9251e04e3dc50ecb66cbd48faa7c6882b80f16a51af0746669cd5f0545b4e066' } else { $env:ODEV21_SUMMARY_STATS_SHA256 }
$PopulationSha = if ([string]::IsNullOrWhiteSpace($env:ODEV21_POPULATION_BUNDLE_SHA256)) { 'bb15684840fbf39a35827c26d8d8c67e4d3b10ffaa3ff1b5d8b36c7ab606dcb6' } else { $env:ODEV21_POPULATION_BUNDLE_SHA256 }
# ODE checkpoint·통계·평균 묶음이 있는 HF 폴더. 새 checkpoint는 revision·SHA와 함께 이 값을 바꿔 고른다.
$OdeHfDir = if ([string]::IsNullOrWhiteSpace($env:ODEV21_HF_DIR)) { 'ode_v21_speedcal_b_lam1' } else { $env:ODEV21_HF_DIR.Trim() }

function Get-ModelUrl([string]$Path) {
    return "https://huggingface.co/$Repo/resolve/$Revision/$Path"
}

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Move-VerifiedFile([string]$Source, [string]$Target) {
    if (Test-Path -LiteralPath $Target -PathType Leaf) {
        [System.IO.File]::Replace($Source, $Target, $null)
    } else {
        [System.IO.File]::Move($Source, $Target)
    }
}

function Download-Verified([string]$Url, [string]$Target, [string]$Expected, [bool]$WithAuth) {
    if ((Test-Path -LiteralPath $Target -PathType Leaf) -and (Get-Sha256 $Target) -eq $Expected.ToLowerInvariant()) {
        Write-Output "Already verified: $Target"
        return
    }

    $Temp = Join-Path (Split-Path -Parent $Target) ((Split-Path -Leaf $Target) + '.download.' + [guid]::NewGuid().ToString('N'))
    try {
        if ($WithAuth) {
            Invoke-WebRequest -Uri $Url -OutFile $Temp -Headers @{ Authorization = "Bearer $env:HF_TOKEN" }
        } else {
            Invoke-WebRequest -Uri $Url -OutFile $Temp
        }
    } catch {
        Remove-Item -LiteralPath $Temp -Force -ErrorAction SilentlyContinue
        throw "Model download failed: $Url"
    }

    if ((Get-Sha256 $Temp) -ne $Expected.ToLowerInvariant()) {
        Remove-Item -LiteralPath $Temp -Force
        throw "Model SHA-256 mismatch: $Target"
    }
    try {
        Move-VerifiedFile $Temp $Target
    } catch {
        Remove-Item -LiteralPath $Temp -Force -ErrorAction SilentlyContinue
        throw "Could not atomically install model: $Target"
    }
    Write-Output "Installed: $Target"
}

function Copy-Verified([string]$Source, [string]$Target, [string]$Expected) {
    if ((Test-Path -LiteralPath $Target -PathType Leaf) -and (Get-Sha256 $Target) -eq $Expected.ToLowerInvariant()) {
        Write-Output "Already verified: $Target"
        return
    }
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Missing model source: $Source" }

    $Temp = Join-Path (Split-Path -Parent $Target) ((Split-Path -Leaf $Target) + '.download.' + [guid]::NewGuid().ToString('N'))
    try {
        Copy-Item -LiteralPath $Source -Destination $Temp
        if ((Get-Sha256 $Temp) -ne $Expected.ToLowerInvariant()) {
            throw "Model SHA-256 mismatch: $Target"
        }
        Move-VerifiedFile $Temp $Target
    } catch {
        Remove-Item -LiteralPath $Temp -Force -ErrorAction SilentlyContinue
        throw
    }
    Write-Output "Installed: $Target"
}

New-Item -ItemType Directory -Force -Path $OdeDir | Out-Null

if (-not [string]::IsNullOrWhiteSpace($env:GRU_MODEL_URL)) {
    # 이전 공개 URL 사용자 지정 호환: 이 URL에는 HF_TOKEN을 전달하지 않는다.
    Download-Verified $env:GRU_MODEL_URL (Join-Path $ModelDir 'gru_final.pt') $GruSha $false
} elseif ($SourceMode -eq 'local') {
    Download-Verified 'https://huggingface.co/doyeonkoo/runway-hr-gru/resolve/main/gru_final.pt' `
        (Join-Path $ModelDir 'gru_final.pt') $GruSha $false
} else {
    Download-Verified (Get-ModelUrl 'gru/gru_final.pt') (Join-Path $ModelDir 'gru_final.pt') $GruSha $true
}

if ($SourceMode -eq 'local') {
    Copy-Verified $env:ODEV21_SOURCE_CHECKPOINT (Join-Path $OdeDir 'ode_epoch_020.pt') $CheckpointSha
    Copy-Verified $env:ODEV21_SOURCE_STATS (Join-Path $OdeDir 'ode_summary_stats.json') $StatsSha
    Copy-Verified $env:ODEV21_POPULATION_BUNDLE_SOURCE `
        (Join-Path $OdeDir 'population_bundle_v2train_median.json') $PopulationSha
} else {
    Download-Verified (Get-ModelUrl "$OdeHfDir/selected_model.pt") `
        (Join-Path $OdeDir 'ode_epoch_020.pt') $CheckpointSha $true
    Download-Verified (Get-ModelUrl "$OdeHfDir/summary_stats.json") `
        (Join-Path $OdeDir 'ode_summary_stats.json') $StatsSha $true
    Download-Verified (Get-ModelUrl "$OdeHfDir/population_bundle_v2train_median.json") `
        (Join-Path $OdeDir 'population_bundle_v2train_median.json') $PopulationSha $true
}

Write-Output "Model assets installed and verified in $ModelDir"
