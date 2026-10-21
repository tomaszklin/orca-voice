# Orca Voice — prywatna wersja Orca Mobile z czytaniem odpowiedzi

Fork [stablyai/orca](https://github.com/stablyai/orca) (licencja MIT), gałąź `voice`.
Zmieniona jest **tylko aplikacja na telefon**. Desktop zostaje oficjalny i aktualizuje się sam.

Powód (2026-10-18): Orca nie ma czytania odpowiedzi agenta na głos (prośba
[#15817](https://github.com/stablyai/orca/issues/15817) bez odzewu). Obejście przez ntfy + SpeakThat!
czyta zawsze i natychmiast, a właściciel chce sam decydować, kiedy słucha.

> **Ważne: większość ekranów Orca Mobile to strona pobierana z desktopu.** Lista workspace'ów,
> sesja/czat, pliki i review przychodzą z komputera (ekran „Downloading the latest app from Dom”;
> lista tras w `%LOCALAPPDATA%\Programs\orca\resources\app.asar.unpacked\out\mobile-web\manifest.json`).
> APK nie może do nich dodać przycisków — dlatego wersja 1 (przycisk przy odpowiedzi na liście,
> 2026-10-18) była niewidoczna. Wersja 2 czyta przez **natywną warstwę** nad nawigacją, niezależną
> od pobieranego widoku. Natywne w APK są m.in. ustawienia i transport RPC.

## Co dodaje (wersja 2, 2026-10-18)

- **Settings → Chat UI → „Auto-read new replies”** — gdy włączone, każda nowa odpowiedź agenta
  jest czytana na głos zaraz po zakończeniu tury, na dowolnym ekranie (lista, czat). Domyślnie
  wyłączone. Działa przy otwartej aplikacji (brak usługi w tle).
- Jak: `useAutoReadReplies` co 15 s (do 2026-10-18: 3 s) pyta każdy połączony host o `worktree.ps` przez natywnego
  klienta RPC, `findNewReplies` wybiera nowe odpowiedzi (pomija podagentów i to, co było przed
  włączeniem przełącznika).
- **Przycisk „Stop”** u góry ekranu, widoczny tylko podczas czytania.
- Czytany tekst: bez bloków kodu i tabel (zamiast nich krótka informacja, po polsku na polskim
  telefonie), bez emoji i formatowania; ścieżki plików skrócone do nazwy. Link markdown czytany
  jako sam opis, goły adres (też `<https://…>`, od 2026-10-21) jako słowo „link”. Dlatego hook
  trybu głosowego od 2026-10-21 pozwala agentowi podawać ważne linki (wcześniej je zakazywał,
  przez co znikały z odpowiedzi np. przy researchu).
- Głos: systemowy syntezator mowy Androida (ten sam, który ustawiono dla SpeakThat!).
- **Nie ma** przycisku „odtwórz” pod każdą odpowiedzią w czacie — czat jest stroną z desktopu.
  Wymagałoby to podmiany widoku na komputerze albo własnej kopii czatu w APK (zob. historia rozmowy
  2026-10-18; właściciel wybrał na razie auto-czytanie).

Do biegania z wygaszonym ekranem dalej służy tryb głosowy na komputerze (ntfy + SpeakThat!) —
zob. `~/.claude/hooks/voice/`.

## Przycisk „Read” w czacie + wbudowana strona (build 4, 2026-10-18)

**Stan: działa na telefonie właściciela (potwierdzone 2026-10-18, build 4).** Auto-czytanie
(opcja) jeszcze nie — w buildzie 3 przy włączonym przełączniku nic nie czytało; diagnostyka w
Settings → Chat UI pokaże, czy problem jest w odpytywaniu `worktree.ps`, czy w wykrywaniu nowych odpowiedzi.

Właściciel chce: auto-czytanie jako opcja + **niezależnie** przycisk „Read” pod każdą odpowiedzią.
Czat to strona z desktopu, więc APK niesie **własną kopię strony** i serwuje ją zamiast desktopowej.

- **Baza forka = wydanie desktopu.** Gałąź `voice` stoi na tagu `v1.4.229` (wersja Orki na
  komputerze), żeby wbudowana strona mówiła tym samym protokołem co desktop. Manifest strony
  porównany z desktopowym: te same trasy, granty, `runtimeProtocolVersion` 3 / min 2, `pageVersion` 1.
  Gdy desktop się zaktualizuje i coś przestanie działać: przenieść forka na nowy tag i przebudować.
- **Mostek:** jeden czasownik `native.speech.control` (`{action:'speak', id, markdown}` |
  `{action:'stop'}`) — `bridge/bridge-speech-verbs.ts`, wpis w `bridge-native-verbs.ts`, obsługa
  `platform/native-speech.ts` ← `use-native-device-verbs.ts`. Jeden, nie dwa, bo trasa sesji ma
  limit 16 grantów. W `config/scripts/mobile-web-page-routes.mjs` jako `optionalGrants` trasy
  sesji — oficjalna powłoka dalej serwuje czat, tylko bez przycisku.
- **Przycisk:** `components/MobileReplyReadButton.tsx` w `session/MobileNativeChatMessage.tsx`
  (obok kopiowania, tylko odpowiedzi asystenta, nie podczas pisania). Mówienie przez
  `platform/reply-speech.ts` (natywnie) / `reply-speech.web.ts` (strona → mostek).
- **Wbudowana strona:** `voice/build-page.mjs` buduje ją esbuildem z zależności `mobile/` (~2 s,
  ~8,4 MB), `build-apk.ps1` kopiuje do `android/app/src/main/assets/voice-page/`.
  `mobile-web-shell/embedded-bundle-source.ts` czyta ją z `asset:///voice-page/…`;
  `mobile-web-shell-session-effects.ts` (`readManifest`, `download`) bierze ją zamiast desktopowej.
- **Przełącznik:** Settings → Chat UI → „Built-in chat page (Read buttons)”, domyślnie włączony
  (`speech/built-in-page-preference.ts`, klucz `orca:voiceBuiltInPage`). Wyłączony = strona z
  desktopu. Zmiana działa dla ekranów otwartych później.
- Odrzucone: łatanie zainstalowanego desktopu (asar z listą plików po hashach → pełny repack,
  restart Orki, powtarzać po każdej aktualizacji).
## Czytanie przy zgaszonym ekranie (build 5–7, 2026-10-18)

**Stan: działa na telefonie właściciela (potwierdzone 2026-10-18, build 7).** Od buildu 7 usługa
nie jest zatrzymywana przy odmontowaniu komponentu, wraca przy każdym powrocie Orki na ekran, a po
ubiciu samej usługi przez system wraca sama (START_STICKY; po śmierci całego procesu kończy się, bo
nie ma JS, który by tykał). Settings → Chat UI pokazuje stan usługi i ostatnie tyknięcie. Hook
trybu głosowego na komputerze ma `push: false` — ntfy i SpeakThat! nie są już potrzebne.

Właściciel wybrał czytanie w tle w samej Orce i zamierza usunąć ntfy + SpeakThat!. Po wygaszeniu
ekranu blokują je trzy rzeczy: Android zamraża proces, React Native wstrzymuje zegary JS, a
transport sam zamyka relay po 30 s w tle (`mobile-relay-background-grace.ts`).

- Moduł natywny `mobile/modules/orca-voice-background` (Kotlin): `ReadAloudService` — usługa
  pierwszoplanowa typu `mediaPlayback` z cichym, stałym powiadomieniem, częściowy wake lock i
  „tyknięcie” co 15 s przekazywane do JS jako zdarzenie `onTick` (zdarzeń nie wstrzymuje tło).
  Zamyka się po zdjęciu Orki z listy ostatnich aplikacji.
- `speech/background-reading.ts`: przełącznik Settings → Chat UI → „Keep reading with the screen
  off” (domyślnie włączony, działa tylko przy włączonym auto-czytaniu; klucz
  `orca:voiceBackgroundReading`), start/stop usługi, odpytywanie na tyknięciach.
- `speech/background-reading-state.ts` + `transport/host-logical-client.ts`: gdy usługa działa,
  połączenie z desktopem jest traktowane jak na pierwszym planie (nie zamyka się po 30 s).
- Koszt: bateria (wake lock + odpytywanie `worktree.ps` co 15 s; od 2026-10-19, wcześniej co 3 s — właściciel wybrał oszczędność baterii kosztem do 15 s opóźnienia).
- **Błąd naprawiony w buildzie 6:** auto-czytanie czekało na `state === 'done'`, a sesja agenta z
  zadaniem w tle (serwer, budowanie) zostaje `working` także po zakończonej turze — z odpowiedzią
  już w `lastAssistantMessage` (sprawdzone logiem `orca worktree ps --json` co 2 s). Teraz
  sygnałem jest nowa niepusta wartość `lastAssistantMessage`, bez względu na stan.
- **Poprawka w buildzie 10 (2026-10-19):** auto-czytanie czytało też wyniki narzędzi (wyszukiwanie w
  internecie, czytane pliki) — host w trakcie tury wpisuje je do `lastAssistantMessage`
  (`PostToolUse`). Teraz bramką jest `mainAgent.state === 'done'` (stan samego głównego agenta;
  przy zadaniu w tle wiersz jest `working`, a `mainAgent` już `done` — sprawdzone logiem
  `orca worktree ps --json`); starsze hosty bez `mainAgent` → stan wiersza.

## Własny silnik mowy (build 9, 2026-10-19)

**Stan: działa (potwierdzone przez właściciela 2026-10-19, build 9).**

W samochodzie (Bluetooth) przycisk Read milczał, a muzyka z YouTube grała dalej bez ściszenia —
expo-speech gra z domyślnymi atrybutami i nie prosi o fokus audio. Po odłączeniu od auta też nie
działało (prawdopodobnie zawieszony silnik TTS po przełączeniu wyjścia; niezweryfikowane).
`modules/orca-voice-background/.../ReadAloudSpeech.kt`: własny `TextToSpeech` z atrybutami
`USAGE_ASSISTANCE_NAVIGATION_GUIDANCE` + `CONTENT_TYPE_SPEECH` (jak komunikaty Map Google),
fokus `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` na czas kolejki, przebudowa silnika po błędzie.
JS: `speech/tts-engine.ts` (zdarzenia `onSpeech` po id), `speech/voice-native-module.ts`;
expo-speech zostaje jako zapas, gdy modułu brak.

## Wszystkie wiadomości, menu „Read aloud”, odporne czytanie (build 11, 2026-10-21)

**Stan: zbudowane, niepotwierdzone na telefonie.**

Zgłoszenia właściciela z 2026-10-21:
- **Czytanie urywało się po kilku sekundach** (Stop + Read od razu pomagało). Przyczyny nie
  ustalono (brak logów z telefonu). Zmiany: odpowiedź idzie w kawałkach ≤ 300 znaków
  (`SPEECH_PIECE_LENGTH` w `speech/reply-speaker.ts`), kawałek przerwany przez silnik jest
  powtarzany raz. `ReadAloudSpeech.kt` liczy wypowiedzi po id, nie licznikiem: spóźnione
  `onStop` starej wypowiedzi nie zwalnia już fokusu ani nie wyłącza silnika nowej; `onStop`, o
  który nie prosiliśmy, idzie do JS jako błąd (wcześniej czytnik czekał w nieskończoność);
  fokus trzymany 1,5 s po ostatnim kawałku, żeby muzyka nie podgłaśniała się między kawałkami.
  **Dziennik czytnika** (ostatnie 15 zdarzeń: start, błąd z kodem, kto zatrzymał) jest w
  Settings → Read aloud pod przełącznikami — przy następnym urwaniu poprosić o zrzut ekranu.
- **Pomijane wiadomości:** `worktree.ps` niesie tylko wiadomość kończącą turę (hook Stop
  Claude'a; w trakcie tury `lastAssistantMessage` to wynik narzędzia), więc wiadomości pisane w
  trakcie pracy nigdy nie były czytane. `speech/chat-message-feeds.ts`: dla każdego głównego
  agenta ten sam strumień `nativeChat.subscribe`, który czyta czat (sesja z `session.tabs.list`
  → `agentStatus.providerSession`); każdy dopisany wiersz asystenta z tekstem jest czytany
  (rozumowanie ma rolę `reasoning` i jest pomijane). Pierwszy snapshot to historia — czytane z
  niego są tylko wiadomości bieżącej tury (`mainAgent.stateStartedAt`). Gdy strumień działa,
  odpowiedź końcowa z `worktree.ps` jest pomijana (czyta ją strumień); już przeczytana nie jest
  czytana drugi raz. Sesje strukturalne (`agent-session`) i agenci bez transkryptu na hoście
  zostają przy odpowiedziach końcowych.
- **Wybór „What to read”** (klucz `orca:voiceReadScope`): `all` (domyślnie) — wszystkie
  wiadomości; `all-on-screen` — wszystkie przy otwartej Orce, końcowe przy zgaszonym ekranie;
  `replies` — tylko końcowe (zachowanie do buildu 10).
- **Odpytywanie:** co 3 s przy otwartej Orce, co 15 s w tle.
- **Menu Settings → Read aloud** (`speech/read-aloud-settings-screen.tsx`, trasa
  `app/read-aloud-settings.tsx`) — wszystkie opcje czytania; Chat UI wrócił do wersji z tagu.
  Dyktowanie zostaje w oficjalnym menu „Voice”.
- Hook trybu głosowego na komputerze pozwala podawać ważne linki (czytane jako opis albo „link”).

## Bez mikrofonu w czacie, czytanie ustępuje dyktowaniu (build 13, 2026-10-21)

**Stan: zbudowane, niepotwierdzone na telefonie.**

- **Mikrofon w czacie ukryty** (`speech/chat-mic.ts`, wstawka w `session/MobileNativeChatOverlay.tsx`).
  Dyktowanie Orki wymaga modelu mowy na komputerze, więc przypadkowe dotknięcie otwierało jego
  konfigurację. Build 12 otwierał zamiast tego systemowe okno rozpoznawania mowy
  (`RecognizerIntent`) — działało, ale bez wypowiadanej interpunkcji („kropka”) i zamykało się po
  krótkiej ciszy, w przeciwieństwie do mikrofonu klawiatury. Dyktowania klawiatury aplikacja nie
  może uruchomić (należy do klawiatury), więc właściciel wybrał usunięcie mikrofonu; build 12
  cofnięty. Dyktuje z klawiatury (dotknięcie pola tekstu → mikrofon klawiatury).
  Odrzucone: własne słuchanie w aplikacji (`SpeechRecognizer`, jedno dotknięcie) — inne
  rozpoznawanie niż w klawiaturze.
- **Czytanie milknie przy dyktowaniu i rozmowie**, jak odtwarzacz muzyki: `ReadAloudSpeech.kt`
  słucha zmian fokusu audio; utrata (`LOSS` / `LOSS_TRANSIENT`) zatrzymuje czytanie i wysyła do
  JS zdarzenie `interrupted` → `stopSpeaking` (kolejka też przepada). Ściszenie
  (`LOSS_TRANSIENT_CAN_DUCK`, np. dźwięk powiadomienia) nie przerywa.
- **Nic nie zaczyna czytać, gdy ktoś mówi do mikrofonu:** przed wypowiedzią sprawdzane są aktywne
  nagrania (`getActiveRecordingConfigurations`, źródła MIC/VOICE_RECOGNITION/VOICE_COMMUNICATION…,
  bez nasłuchu „Hey Google”); wtedy wypowiedź czeka na zwolnienie mikrofonu (najwyżej 2 min),
  bo zabranie fokusu przerwałoby dyktowanie. W dzienniku czytnika: „waiting for the microphone”.

## Tymczasowe wyciszenie auto-czytania (build 14, 2026-10-21)

**Stan: zbudowane, niepotwierdzone na telefonie.** Build 13 potwierdzony przez właściciela
(2026-10-21: mikrofon ukryty, czytanie milknie przy dyktowaniu).

- Przycisk **Mute / Unmute** w powiadomieniu usługi czytania (`ReadAloudService.kt`, akcja
  `TOGGLE_MUTE` → zdarzenie `onMuteToggle` do JS) i przełącznik „Mute for now” w Settings → Read
  aloud. Wyciszenie zatrzymuje bieżące czytanie, nie zmienia ustawienia auto-czytania i żyje tylko
  w pamięci JS (`speech/auto-read-mute.ts`) — restart Orki zawsze wraca do stanu niewyciszonego.
  Przycisk Read pod wiadomością dalej czyta.
- Powiadomienie istnieje tylko przy włączonym „Keep reading with the screen off”. Jest ciche
  (niski priorytet), więc przycisk może być widoczny dopiero po rozwinięciu powiadomienia.

## Budowanie

```powershell
pwsh -File E:\Projects\OrcaVoice\voice\build-apk.ps1
```

Wynik: `voice\dist\orca-voice-<wersja>.apk` (ok. 55 MB, tylko arm64). Pierwsze budowanie trwa
długo (Gradle pobiera zależności, kompiluje C++), kolejne kilka minut.

Dwie poprawki pod Windows, wbudowane w skrypt (bez nich kompilacja C++ `react-native-worklets`
kończy się „ninja: manifest 'build.ninja' still dirty after 100 tries” — za długie ścieżki):
- `node_modules` w układzie płaskim (`pnpm_config_node_linker=hoisted`; lockfile bez zmian),
- CMake 3.31.6 z ninja 1.12 (`sdkmanager "cmake/3.31.6"`) wskazany w `android/local.properties`.
Skrypt robi `expo prebuild --clean`, więc katalog `mobile/android/` jest za każdym razem generowany od nowa.

## Aktualizacje z serwera HAL (od buildu 15, 2026-10-21)

Właściciel chciał, żeby „Check for updates” w aplikacji szukał naszych buildów, jak HAL 9000 z
projektu SmartHome (`E:\Projects\SmartHome\09-aplikacja-hal.md`).

```powershell
pwsh -File E:\Projects\OrcaVoice\voice\build-apk.ps1
pwsh -File E:\Projects\OrcaVoice\voice\publish-apk.ps1
```

- `publish-apk.ps1` kopiuje przez SSH (dodatek Terminal & SSH w Home Assistant, klucz
  `~/.ssh/smarthome_ed25519`, ten sam co HAL) do `/homeassistant/www/orca-voice/`:
  `orca-voice-<wersja>-b<N>.apk`, `orca-voice.apk` (zawsze najnowszy), na końcu `version.json`
  `{build, version, file, date}`; zostają 3 ostatnie APK. HA serwuje to bez logowania tylko w domu i
  przez ZeroTier: `http://192.168.0.223/local/orca-voice/`, `http://172.24.140.251/local/orca-voice/`.
  Pobierze to każdy w domowym Wi-Fi — APK nie ma żadnych tokenów (parowanie jest na telefonie).
- Aplikacja (`app-update/voice-build-update-source.ts`, wstawki w `app-update-runtime.ts` i
  `app-update-checker.ts`): build z numerem (`extra.voiceBuild`) pyta oba adresy naraz o
  `version.json` (zamiast GitHuba Orki) i porównuje numery buildów („Orca build 15 is available”).
  „Update” pobiera APK w aplikacji z postępem w powiadomieniu i otwiera systemowy instalator
  (`UpdateInstaller.kt`, `UpdateFileProvider`, uprawnienie `REQUEST_INSTALL_PACKAGES`); przy
  pierwszym razie Android prosi o zgodę na instalowanie z Orki. Sprawdzanie: raz dziennie, przy
  starcie i przyciskiem „Check for updates”.
- Builds ≤ 14 pytają jeszcze GitHuba Orki: build 15 trzeba zainstalować ręcznie (link niżej albo
  `http://172.24.140.251/local/orca-voice/orca-voice.apk`), kolejne przyjdą przez aplikację.
- Oficjalnych wersji Orki aplikacja już nie zgłasza — nowy tag desktopu sprawdzać ręcznie.

## Przesłanie na telefon (ręcznie)

Telefon łączy się z komputerem przez **ZeroTier** (IP komputera w tej sieci: `172.24.212.29`,
stan 2026-10-18). Plik ma ok. 55 MB — za dużo na ntfy.

```powershell
& "C:\Program Files\nodejs\node.exe" E:\Projects\OrcaVoice\voice\serve-apk.mjs 172.24.212.29
```

Wypisuje jednorazowy link (losowy token), który otwiera się w przeglądarce telefonu. Serwer słucha
tylko na adresie ZeroTier i wyłącza się po 30 minutach. Używa **systemowego** Node, bo tylko on ma
regułę w zaporze Windowsa (profil Public, na którym jest karta ZeroTier); bez uprawnień
administratora nie da się dodać nowej reguły.

**Podpis:** wydanie jest podpisane publicznym kluczem debug z szablonu React Native — tak samo jak
oficjalne APK Orca Mobile (sprawdzone 2026-10-18). Dlatego ta wersja instaluje się **na** oficjalną,
z zachowaniem parowania. Powrót do oryginału: zainstalować oficjalne APK z wydań na GitHubie.

## Narzędzia (lokalne, poza gitem)

`.voice-tools/` — Node 24.22.0 (portable, sprawdzona suma SHA256) i pnpm 12.8.1. Globalny Node
w systemie to 20.x i zostaje nietknięty. Java: Microsoft JDK 17. Android SDK:
`%LOCALAPPDATA%\Android\Sdk` (Gradle sam dociąga brakujące NDK/CMake).

## Aktualizacja z upstream

Fork ma stać na **tagu wersji desktopu**, którą właściciel ma zainstalowaną (wersja: pole
`desktopVersion` w `%LOCALAPPDATA%\Programs\orca\resources\app.asar.unpacked\out\mobile-web\manifest.json`).
Protokół telefon ↔ desktop toleruje różnice wersji (zmiany addytywne), więc nie trzeba gonić
każdej aktualizacji — przebudować, gdy coś przestanie działać albo przyda się nowa funkcja:

1. `git fetch --tags origin`, potem przenieść zmiany forka na nowy tag (stash → `git checkout -B voice vX.Y.Z` → stash pop).
2. Konflikt w `mobile/pnpm-lock.yaml` → wziąć wersję z tagu i `pnpm add expo-speech@~<wersja>`
   (z `pnpm_config_node_linker=hoisted`).
3. Testy: `pnpm exec vitest run src/speech src/settings src/session src/mobile-web-shell src/platform`.
4. `pwsh -File voice\build-apk.ps1`, potem `voice\publish-apk.ps1` (telefon dostanie aktualizację w aplikacji).

Uwaga: oficjalne APK Orki zainstalowane na tę wersję usuwa czytanie (wraca oryginał).

## Testy — stan 2026-10-18 (build 4)

Zmiany forka mają testy w `src/speech/*.test.ts`; zaktualizowane listy grantów w
`page-route-policy.test.ts` i `bridge-host-init.test.ts`; przycisk Read jest zamockowany globalnie
w `vitest.setup.ts`, żeby nie ruszać mocków w testach czatu Orki. Testy czatu, mostka, ustawień i
mowy przechodzą. Na tym Windowsie **niezależnie od zmian** (sprawdzone na czystym tagu) nie
przechodzi 70 testów w `rpc-recording/*` i `native-document-bundle` oraz kilka plików, którym
brakuje zależności głównego workspace'u (`zod`, `oxc-parser`…). `tsc --noEmit`: 7 błędów, wszystkie
w plikach spoza zmian (brak tych samych zależności).