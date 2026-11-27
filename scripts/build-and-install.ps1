[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Otter Music 一键构建与安装工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 构建前端并同步到 Android
Write-Host "[1/3] 构建前端并同步到 Android (npm run cap:sync:android)..." -ForegroundColor Yellow
& npm run cap:sync:android
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[失败] 前端构建或 Capacitor 同步失败 (退出码: $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}

# 2. 解析 adb 路径（优先读取 android/local.properties 中的 sdk.dir）
$adbPath = $null
$localProps = Join-Path $repoRoot "android\local.properties"
if (Test-Path $localProps) {
    $sdkLine = Get-Content $localProps | Where-Object { $_ -match "^sdk\.dir=" } | Select-Object -First 1
    if ($sdkLine) {
        $sdkDir = ($sdkLine -replace "^sdk\.dir=", "").Replace("\:", ":").Replace("\\", "\").Trim()
        $candidate = Join-Path $sdkDir "platform-tools\adb.exe"
        if (Test-Path $candidate) {
            $adbPath = $candidate
        }
    }
}
if (-not $adbPath) {
    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) { $adbPath = $cmd.Source }
}

$hasDevice = $false
if ($adbPath) {
    $devOut = & $adbPath devices 2>$null
    $connected = $devOut | Where-Object { $_ -match "\tdevice$" }
    if ($connected) {
        $hasDevice = $true
        Write-Host "`n[2/3] 检测到已连接的 Android 设备：" -ForegroundColor Green
        $connected | ForEach-Object { Write-Host "      $_" -ForegroundColor Gray }
    }
}

# 3. 编译并安装（有设备则 installDebug，无设备则 assembleDebug）
$androidDir = Join-Path $repoRoot "android"
$gradlew = Join-Path $androidDir "gradlew.bat"

Push-Location $androidDir
try {
    if ($hasDevice) {
        Write-Host "`n[3/3] 编译并安装 Debug APK (gradlew installDebug)..." -ForegroundColor Yellow
        & $gradlew installDebug
    } else {
        Write-Host "`n[2/3] 未检测到已连接的 Android 设备，将仅编译 Debug APK..." -ForegroundColor DarkYellow
        Write-Host "[3/3] 编译 Debug APK (gradlew assembleDebug)..." -ForegroundColor Yellow
        & $gradlew assembleDebug
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n[失败] Android 构建失败 (退出码: $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}

$sw.Stop()
$elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 1)
$apkDir = Join-Path $repoRoot "android\app\build\outputs\apk\debug"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
if ($hasDevice) {
    Write-Host "  构建并安装成功！耗时 ${elapsed}s" -ForegroundColor Green
} else {
    Write-Host "  APK 编译成功！耗时 ${elapsed}s" -ForegroundColor Green
    Write-Host "  输出目录: $apkDir" -ForegroundColor Gray
}
Write-Host "========================================" -ForegroundColor Green
