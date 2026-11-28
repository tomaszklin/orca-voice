# Orca Remote na zegarku Garmin (prototyp, 2026-11-28)

Cel: sterować Orką w biegu z zegarka (Forerunner 970), bez dotykania telefonu w rękawiczkach.

Pomysł: aplikacja z Connect IQ typu **dostawca muzyki** (jak Spotify czy YouTube Music na liście
„Dodaj aplikację muzyczną”). Wbudowane sterowanie muzyką na zegarku działa w trakcie biegu,
a dostawca pokazuje w nim własne „utwory”. Tu każdy utwór to sesja agenta. Następny i poprzedni
przełączają sesję, pauza i kciuki są dodatkowymi przyciskami. Każde naciśnięcie idzie do Orki
na telefonie (`GarminRemote.kt`), która na razie tylko mówi, co przyszło.

Prototyp ma sprawdzić trzy rzeczy:

1. Czy zegarek gra z takiego źródła bez słuchawek połączonych z zegarkiem (raczej nie, wtedy
   Shokz musi być połączony z telefonem i zegarkiem naraz).
2. Czy naciśnięcia docierają do aplikacji w trakcie biegu (dziennik w menu aplikacji).
3. Czy z odtwarzacza da się wysłać sygnał do telefonu (`tx ok` w dzienniku i głos z telefonu)
   oraz czy jest sieć (`web 200`).

## Pliki

- `orca-remote/` to projekt Connect IQ (Monkey C): manifest, źródła i zasoby.
- `audio/orca-remote-track.mp3` to jedyny „utwór”: krótki ton i 5 minut ciszy. Zegarek
  pobiera go przy synchronizacji z jsDelivr (gałąź `voice` tego repo). jsDelivr podaje typ
  `audio/mpeg`, którego wymaga Garmin, a raw.githubusercontent.com tego nie robi.
- Część na telefonie: `mobile/modules/orca-voice-background/android/.../GarminRemote.kt` oraz
  zależność `com.garmin.connectiq:ciq-companion-app-sdk`. Wiadomości z zegarka idą przez aplikację
  Garmin Connect na telefonie.

## Budowanie

- SDK Connect IQ: `%APPDATA%\Garmin\ConnectIQ\Sdks\connectiq-sdk-win-9.3.0-…` (pobrane bez
  logowania). Pliki urządzeń (`fr970`) wymagają logowania do konta Garmin w SDK Managerze
  (`%APPDATA%\Garmin\ConnectIQ\SdkManager\sdkmanager.exe`, zakładka Devices).
- Klucz deweloperski: `%APPDATA%\Garmin\ConnectIQ\developer_key.der`. Jest tylko lokalnie, nie w repo.
- Kompilacja: `monkeyc -f monkey.jungle -d fr970 -y <klucz> -o OrcaRemote.prg`.
- Wgranie: zegarek kablem USB, plik `.prg` do `GARMIN\APPS`.

## Na zegarku

Sterowanie muzyką, potem „Dodaj aplikację muzyczną”, Orca Remote. W menu aplikacji wybierz
„Pobierz dzwiek” (synchronizacja przez Wi-Fi), potem „Graj”. Dziennik w tym samym menu pokazuje
zdarzenia z godziną.
