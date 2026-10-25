# Wystawia build Orca Voice jako wydanie na GitHubie (publiczny fork tomaszklin/orca-voice). Stamtąd
# aplikacja sama się aktualizuje (od buildu 20: Settings → Check for updates) i stamtąd można ją komuś dać.
# Użycie:  pwsh -File voice\publish-github.ps1            (ostatni zbudowany build)
#          pwsh -File voice\publish-github.ps1 -Build 19
#
# Wydanie `voice-b<N>` (znacznik na bieżącym commicie, jeśli go jeszcze nie ma) z dwoma plikami:
# orca-voice-<wersja>-b<N>.apk i version.json { build, version, file, date }. Aplikacja czyta je przez
# https://github.com/tomaszklin/orca-voice/releases/latest/download/, czyli zawsze z najnowszego wydania.
param([int]$Build)

$ErrorActionPreference = 'Stop'
$repo = 'tomaszklin/orca-voice'
$buildFile = Join-Path $PSScriptRoot 'build-number.txt'
if (-not $Build) { $Build = [int](Get-Content $buildFile) }
$apk = Get-ChildItem (Join-Path $PSScriptRoot 'dist') -Filter "orca-voice-*-b$Build.apk" | Select-Object -First 1
if (-not $apk) { throw "Brak APK buildu $Build w voice\dist - najpierw voice\build-apk.ps1." }

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE) { throw "$Exe nie powiódł się (kod $LASTEXITCODE)" }
}

$tag = "voice-b$Build"
if (-not (git -C $PSScriptRoot tag --list $tag)) { Invoke-Checked git @('-C', $PSScriptRoot, 'tag', $tag, 'HEAD') }
Invoke-Checked git @('-C', $PSScriptRoot, 'push', "https://github.com/$repo.git", 'refs/heads/voice:refs/heads/voice', "refs/tags/$tag")

$version = ($apk.BaseName -replace '^orca-voice-', '') -replace "-b$Build$", ''
$index = [ordered]@{ build = $Build; version = $version; file = $apk.Name; date = (Get-Date -Format 'yyyy-MM-dd') }
$tmp = New-Item -ItemType Directory -Force (Join-Path ([IO.Path]::GetTempPath()) "orca-voice-release-$Build")
$local = Join-Path $tmp 'version.json'
$index | ConvertTo-Json -Compress | Set-Content $local -Encoding utf8NoBOM

$notes = @"
Android build $Build of Orca Voice, a fork of [Orca](https://github.com/stablyai/orca) Mobile that reads agent replies aloud.

Install: open this page on the phone, download **$($apk.Name)** and open it. It installs over the official Orca Mobile app and keeps its pairing. Later builds arrive in the app (Settings → Check for updates).

Changes: [voice/README.md](https://github.com/$repo/blob/voice/voice/README.md) (Polish).
"@

Write-Host "Wydanie $tag na github.com/$repo..."
Invoke-Checked gh @('release', 'create', $tag, $apk.FullName, $local, '--repo', $repo,
    '--title', "Orca Voice build $Build", '--notes', $notes, '--latest')
Remove-Item -Recurse $tmp
Write-Host "Gotowe: https://github.com/$repo/releases/tag/$tag"
