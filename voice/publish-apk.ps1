# Wystawia build Orca Voice na serwerze HAL (Home Assistant), skąd aplikacja sama się aktualizuje
# (Settings → Check for updates, karta na ekranie głównym) - tak jak HAL 9000 z projektu SmartHome.
# Użycie:  pwsh -File voice\publish-apk.ps1            (ostatni zbudowany build)
#          pwsh -File voice\publish-apk.ps1 -Build 15
#
# Na serwerze (/homeassistant/www/orca-voice/ = http://192.168.0.223/local/orca-voice/, przez ZeroTier
# http://172.24.140.251/local/orca-voice/, bez logowania, tylko dom i ZeroTier): orca-voice-<wersja>-b<N>.apk,
# orca-voice.apk (zawsze najnowszy) i na końcu version.json { build, version, file, date }.
param([int]$Build)

$ErrorActionPreference = 'Stop'
$buildFile = Join-Path $PSScriptRoot 'build-number.txt'
if (-not $Build) { $Build = [int](Get-Content $buildFile) }
$apk = Get-ChildItem (Join-Path $PSScriptRoot 'dist') -Filter "orca-voice-*-b$Build.apk" | Select-Object -First 1
if (-not $apk) { throw "Brak APK buildu $Build w voice\dist - najpierw voice\build-apk.ps1." }

$target = $env:HAL_SSH ?? 'root@192.168.0.223'
$key = $env:HAL_SSH_KEY ?? (Join-Path $HOME '.ssh\smarthome_ed25519')
$dir = '/homeassistant/www/orca-voice'
$keep = 3
$ssh = @('-i', $key, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    '-o', 'StrictHostKeyChecking=accept-new')

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE) { throw "$Exe nie powiódł się (kod $LASTEXITCODE)" }
}

Write-Host "Wysyłam $($apk.Name) na serwer HAL ($target`:$dir)..."
Invoke-Checked ssh ($ssh + @($target, "mkdir -p $dir"))
Invoke-Checked scp ($ssh + @($apk.FullName, "${target}:$dir/"))
Invoke-Checked ssh ($ssh + @($target, "cp -f $dir/$($apk.Name) $dir/orca-voice.apk"))

# Indeks na końcu, żeby aplikacja nie zobaczyła wersji, której plik jeszcze się nie wgrał.
$version = ($apk.BaseName -replace '^orca-voice-', '') -replace "-b$Build$", ''
$index = [ordered]@{ build = $Build; version = $version; file = $apk.Name; date = (Get-Date -Format 'yyyy-MM-dd') }
$local = Join-Path ([IO.Path]::GetTempPath()) 'orca-voice-version.json'
$index | ConvertTo-Json -Compress | Set-Content $local -Encoding utf8NoBOM
Invoke-Checked scp ($ssh + @($local, "${target}:$dir/version.json"))
Remove-Item $local

Invoke-Checked ssh ($ssh + @($target, "cd $dir && ls -t orca-voice-*-b*.apk | tail -n +$($keep + 1) | xargs -r rm -f"))
Write-Host "Gotowe: http://192.168.0.223/local/orca-voice/$($apk.Name) (przez ZeroTier: http://172.24.140.251/local/orca-voice/)"
