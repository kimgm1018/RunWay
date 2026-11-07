# Capture Android emulator screenshot into docs/qa/images/<suite>/<tcId>.png
# Usage:
#   .\scripts\qa\capture-emu-screenshot.ps1 -Suite s01 -TcId TC-S01-01
#   .\scripts\qa\capture-emu-screenshot.ps1 -Suite s01 -TcId TC-S01-01 -Serial emulator-5554

param(
    [Parameter(Mandatory = $true)][string]$Suite,
    [Parameter(Mandatory = $true)][string]$TcId,
    [string]$Serial = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$outDir = Join-Path $repoRoot "docs\qa\images\$Suite"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir "$TcId.png"

$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:Path"

if (-not $Serial) {
    $line = adb devices | Where-Object { $_ -match '^(emulator-\d+)\s+device' } | Select-Object -First 1
    if ($line -match '^(emulator-\d+)') { $Serial = $Matches[1] }
}
if (-not $Serial) {
    throw '연결된 에뮬레이터가 없습니다. adb devices를 확인하세요.'
}

# Use cmd redirection so PNG stays binary (PowerShell > corrupts)
cmd /c "adb -s $Serial exec-out screencap -p > `"$outFile`""
if (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -lt 1000) {
    throw "스크린샷 저장 실패: $outFile"
}

Write-Output "saved=$outFile serial=$Serial bytes=$((Get-Item $outFile).Length)"
