# Buduje prywatną wersję Orca Mobile (z czytaniem odpowiedzi na głos) do pliku APK.
# Użycie:  pwsh -File voice\build-apk.ps1            (tylko arm64 - wystarczy na telefon)
#          pwsh -File voice\build-apk.ps1 -AllAbis   (wszystkie architektury, jak oficjalne wydanie)
param([switch]$AllAbis)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tools = Join-Path $root '.voice-tools'
$node = Get-ChildItem $tools -Directory -Filter 'node-v24*' | Select-Object -First 1
if (-not $node) { throw "Brak Node 24 w $tools - zob. voice\README.md, sekcja Narzędzia." }

$env:PATH = "$($node.FullName);$tools\pnpm;$env:PATH"
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
$env:EXPO_NO_GIT_STATUS = '1'
$env:CI = '1'

# Numer builda: rośnie przy każdym budowaniu, widać go w Orce (About, Settings → Chat UI),
# w informacjach o aplikacji Androida (versionName) i w nazwie pliku APK.
$buildFile = Join-Path $PSScriptRoot 'build-number.txt'
$buildNumber = 1 + [int]((Get-Content $buildFile -ErrorAction SilentlyContinue) ?? 0)
$env:ORCA_VOICE_BUILD = "$buildNumber"
Write-Host "Orca Voice build $buildNumber"

Push-Location (Join-Path $root 'mobile')
try {
    # Why: domyślny układ pnpm (.pnpm\pakiet@wersja_hash\node_modules\...) wydłuża ścieżki tak,
    # że kompilacja C++ react-native-worklets przekracza limity Windowsa ("build.ninja still dirty
    # after 100 tries"). Płaski układ (hoisted) skraca je o ok. 70 znaków; lockfile bez zmian.
    # pnpm 12 ignoruje tu flagi --config.*; ustawienia działają przez zmienne pnpm_config_*.
    # Demon Gradle z poprzedniego budowania trzyma pliki w android\, a prebuild --clean je kasuje.
    if (Test-Path 'android\gradlew.bat') {
        Push-Location android
        try { .\gradlew.bat --stop *> $null } finally { Pop-Location }
    }
    # --stop nie zawsze łapie demona (i nigdy demona Kotlina). Zamykamy tylko procesy Javy z tego
    # samego JDK co budowanie - Android Studio używa własnego JBR, więc jego demonów to nie dotyczy.
    $jdkJava = Join-Path $env:JAVA_HOME 'bin\java'
    Get-CimInstance Win32_Process -Filter "Name='java.exe'" |
        Where-Object { $_.CommandLine -like "*$jdkJava*" -and $_.CommandLine -match 'gradle|kotlin' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1

    $env:pnpm_config_node_linker = 'hoisted'
    $env:pnpm_config_confirm_modules_purge = 'false'
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE) { throw 'pnpm install nie powiódł się' }
    # Why: react-native-libsodium (od v1.4.243) podaje CMake'owi ścieżkę node_modules z "\", a CMake
    # czyta "\P" w cudzysłowie jako błędną sekwencję ("Invalid character escape"). Oficjalne
    # wydania budują się na Linuksie/macOS, więc tego nie widzą. Zamiana na "/" jest bezpieczna.
    $sodiumGradle = 'node_modules\react-native-libsodium\android\build.gradle'
    if (Test-Path $sodiumGradle) {
        $sodium = Get-Content $sodiumGradle -Raw
        $sodiumFixed = $sodium.Replace('"-DNODE_MODULES_DIR=${nodeModules}"', '"-DNODE_MODULES_DIR=${nodeModules.replace(''\\'', ''/'')}"')
        if ($sodiumFixed -ne $sodium) { Set-Content $sodiumGradle $sodiumFixed -NoNewline -Encoding utf8 }
    }
    # --clean: generowany katalog android/ trzyma w cache ścieżki modułów (autolinking), które
    # po zmianie układu node_modules wskazują w próżnię.
    pnpm exec expo prebuild --platform android --no-install --clean
    if ($LASTEXITCODE) { throw 'expo prebuild nie powiódł się' }

    # Wbudowana strona (lista, czat z przyciskiem Read…) - aplikacja serwuje ją zamiast tej z
    # desktopu, gdy w Settings → Chat UI włączony jest „Built-in chat page”.
    node (Join-Path $PSScriptRoot 'build-page.mjs') 'android\app\src\main\assets\voice-page'
    if ($LASTEXITCODE) { throw 'budowanie wbudowanej strony nie powiodło się' }

    # Why: domyślny CMake 3.22.1 ma ninja 1.10, które na Windowsie gubi się na długich ścieżkach
    # pnpm ("build.ninja still dirty after 100 tries"); ninja 1.12 z CMake 3.31.6 je obsługuje.
    $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME.TrimEnd('\') } else { "$env:LOCALAPPDATA\Android\Sdk" }
    # Why: ANDROID_HOME w tym systemie zaczyna się od małego "c:", a różna wielkość litery dysku
    # w ścieżkach też potrafi wpędzić ninja w pętlę regenerowania.
    $sdk = $sdk.Substring(0, 1).ToUpper() + $sdk.Substring(1)
    $env:ANDROID_HOME = $sdk
    $cmake = Join-Path $sdk 'cmake\3.31.6'
    if (-not (Test-Path $cmake)) { throw "Brak CMake 3.31.6 - zainstaluj: sdkmanager `"cmake/3.31.6`"" }
    @("sdk.dir=$($sdk -replace '\\', '\\')", "cmake.dir=$($cmake -replace '\\', '\\')") |
        Set-Content 'android\local.properties' -Encoding ascii

    # Tylko versionName Androida dostaje dopisek - wersja w app.json (z niej aplikacja sprawdza
    # aktualizacje) i versionCode zostają jak w oficjalnym wydaniu.
    $version = (Get-Content app.json -Raw | ConvertFrom-Json).expo.version
    $gradleFile = 'android\app\build.gradle'
    $gradle = Get-Content $gradleFile -Raw
    $patched = $gradle -replace "versionName `"$([regex]::Escape($version))`"", "versionName `"$version-voice.$buildNumber`""
    if ($patched -eq $gradle) { throw "Nie znalazłem versionName `"$version`" w $gradleFile" }
    Set-Content $gradleFile $patched -NoNewline -Encoding utf8

    $abis = if ($AllAbis) { 'armeabi-v7a,arm64-v8a,x86,x86_64' } else { 'arm64-v8a' }
    Push-Location android
    try {
        .\gradlew.bat assembleRelease "-PreactNativeArchitectures=$abis" --console=plain
        if ($LASTEXITCODE) { throw 'gradle assembleRelease nie powiódł się' }
    } finally { Pop-Location }

    $dist = Join-Path $PSScriptRoot 'dist'
    New-Item -ItemType Directory -Force $dist | Out-Null
    $apk = Join-Path $dist "orca-voice-$version-b$buildNumber.apk"
    Copy-Item 'android\app\build\outputs\apk\release\app-release.apk' $apk -Force
    # Zapisany dopiero po udanym budowaniu, żeby nieudane próby nie zjadały numerów.
    Set-Content $buildFile $buildNumber -Encoding ascii
    Write-Host "Gotowe: $apk"
} finally { Pop-Location }
