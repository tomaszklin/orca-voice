# Orca Voice — własna wersja Orca Mobile z czytaniem odpowiedzi

Fork [stablyai/orca](https://github.com/stablyai/orca) (licencja MIT), gałąź `voice`. Od 2026-10-25
publiczny: [tomaszklin/orca-voice](https://github.com/tomaszklin/orca-voice), APK w Releases.
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

- **Baza forka = wydanie Orki** (od 2026-10-28 `v1.4.243`; wcześniej `v1.4.229`). Zob. „Aktualizacja
  z upstream”.
- **Mostek:** jeden czasownik `native.speech.control` (`{action:'speak', id, markdown}` |
  `{action:'stop'}`) — `bridge/bridge-speech-verbs.ts`, wpis w `bridge-native-verbs.ts`, obsługa
  `platform/native-speech.ts` ← `use-native-device-verbs.ts`. Jeden, nie dwa, bo trasa sesji ma
  limit grantów. W `config/scripts/mobile-web-page-routes.mjs` jako `optionalGrants` trasy
  sesji — oficjalna powłoka dalej serwuje czat, tylko bez przycisku.
- **Limit grantów podniesiony z 16 na 18** (`src/shared/mobile-web-bundle/manifest-contract.ts`,
  od 2026-10-28): w `v1.4.243` trasa sesji ma już 16 (13 + 3 opcjonalne), nasz jest 17. Wbudowaną
  stronę i powłokę APK budujemy z tego samego kodu, a strona z desktopu dalej mieści się w 16.
  18, nie 17, bo test Orki dzieli limit na pół.
- **Przycisk:** `components/MobileReplyReadButton.tsx` w
  `session/native-chat/transcript/MobileNativeChatMessage.tsx` (od `v1.4.243`; wcześniej `session/`)
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
  Od buildu 23 zamiast napisu jest ikona głośnika i kafelek w szybkich ustawieniach (niżej).

## Szybkość i głos czytania (build 17, 2026-10-23)

**Stan: zbudowane, niepotwierdzone na telefonie.**

Właściciel chciał zmieniać szybkość i rodzaj głosu w samej aplikacji (wcześniej tylko systemowe
ustawienia „Zamiana tekstu na mowę”, wspólne dla całego telefonu).

- Settings → Read aloud → grupa **VOICE**: „Speed” (Phone setting, 0.8×–2×), „Voice” (Phone
  setting albo jeden z zainstalowanych głosów w języku, w którym silnik czyta), „Test voice” i
  skrót do systemowych ustawień TTS (pobieranie głosów, inny silnik). Wybór od razu czyta próbkę.
- Głosy Google mają nazwy typu `pl-pl-x-oda-local` / `-network`, więc lista je numeruje („Voice 2 ·
  Offline” / „Voice 2 · Needs internet”, para lokalny/sieciowy ma ten sam numer) —
  `speech/voice-choice.ts`. Głosy sieciowe wymagają internetu.
- Ustawienia trzyma **moduł natywny** (SharedPreferences `orca-voice-speech`), nie AsyncStorage,
  żeby pierwsze czytanie po restarcie już ich używało. `ReadAloudSpeech.kt` nakłada je na każdy
  nowy silnik (też po przebudowie po błędzie); zmiana działa od następnego kawałka odpowiedzi.
  „Phone setting” przywraca systemową szybkość (`TTS_DEFAULT_RATE`) i domyślny głos silnika.
- JS: `speech/speech-options.ts`, `speech/read-aloud-voice-settings.tsx`; style ekranu wydzielone do
  `speech/read-aloud-settings-styles.ts`. Zapasowe expo-speech (bez modułu) ustawień nie ma.
- **Build 18 (2026-10-23, na prośbę właściciela):** szybkość przyciskami − / + co 0,05 w zakresie
  0,75–2 (pierwszy krok od systemowej szybkości, którą moduł podaje jako `phoneRate`), wiersz „Use
  the phone's speed” wraca do ustawienia telefonu; próbka czyta się 0,6 s po ostatnim dotknięciu.
  **Głosy online ukryte** (na trasie bez zasięgu milkną) — na liście tylko offline, chyba że głos
  online był już wybrany.

## Dowolny plik w czacie (build 19, 2026-10-25) — usunięte 2026-10-28

**Stan: usunięte przy przejściu na `v1.4.243`.** Oficjalna Orka ma to samo od `v1.4.240` (#30359):
w polu wiadomości plus → „Files” (dowolny typ, kilka naraz), wysyłane jako prawdziwy załącznik
czatu (`agentSessionAttachment.*`) z nazwą pliku (nazwa od `v1.4.243`, #32987). Wymaga desktopu
co najmniej `v1.4.240`. Właściciel chciał to zgłosić do Orki jako PR — odpadło, bo już to mają.
Opis obejścia poniżej zostaje dla historii.

Właściciel chciał wysłać agentowi PDF, a czat pozwalał załączyć tylko zdjęcie (galeria).

- Obok przycisku zdjęcia w polu wiadomości jest **spinacz „Attach file”** — systemowy wybór
  plików, dowolny typ, najwyżej 18 MB (`mobile/src/file-attach/`; wstawki w
  `session/MobileNativeChatComposer.tsx` i `session/MobileSessionActiveContent.tsx` przez kontekst).
- **Jedyna droga bajtów z telefonu na desktop to metody `clipboard.*ImageUpload`** — desktop nie
  pozwala telefonowi na `files.writeBase64` ani `agentSessionAttachment.*` (lista
  `runtime-rpc-mobile-method-routing.ts`, desktop 1.4.229; „sprawdzone do v1.4.240” było błędem — `v1.4.240` już na to pozwala). Desktop
  zapisuje każdą przesyłkę bez sprawdzania treści jako `%TEMP%\orca-paste-<czas>-<uuid>.png`.
- Dlatego plik nie jest „obrazkiem” w wiadomości, tylko tekstem dopisanym do szkicu, np.
  `[File from my phone (PDF), saved on this computer as `…png`. It is not an image despite the .png
  name: copy it to a .pdf file before opening it.]` (`file-attach/chat-file-reference.ts`).
  Ścieżka w backtickach i nie na końcu: goła ścieżka `.png` wklejona do Claude Code zostałaby
  dołączona jako obraz, a PDF jako obraz psuje rozmowę (błąd API przy każdym kolejnym kroku).
  Bez `@` z tego samego powodu.
- Na wbudowanej stronie (czat) nazwa pliku nie dociera — werbalny `native.media.pick` niesie tylko
  typ MIME; rozszerzenie bierze się z typu (lista znanych typów w `chat-file-reference.ts`).
  Dodanie nazwy wymagałoby zmiany ścisłego schematu mostka (oficjalna strona z desktopu by go
  odrzuciła).
- Zdjęcie wybrane spinaczem trafia jako tekst „[Image from my phone…]”, nie jako miniatura —
  do zdjęć dalej służy przycisk obrazka.

## Nazwa projektu przed wiadomością (build 21, 2026-10-25)

**Stan: zbudowane, niepotwierdzone na telefonie.**

Właściciel chciał słyszeć, z którego projektu jest czytana wiadomość.

- Settings → Read aloud → **PROJECT NAME**: „When the project changes” (domyślnie), „Before every
  message”, „Off” (klucz `orca:voiceProjectName`). „When the project changes” mówi nazwę, gdy
  poprzednia czytana wiadomość była z innego projektu albo minęły 2 minuty ciszy — żeby kilka
  wiadomości jednego agenta nie zaczynało się za każdym razem od nazwy.
- Nazwa to `repo` z wiersza `worktree.ps` (dla workspace'u-folderu też jego nazwa; awaryjnie
  `displayName` — dla głównych worktree to często tylko „main”). Złączone słowa są rozdzielane
  („OrcaVoice” → „Orca Voice”), bo syntezator czytałby je jako jedno słowo.
- Tylko auto-czytanie; przycisk Read pod wiadomością czyta bez nazwy (czat i tak jest na ekranie).
  Nazwa idzie jako osobny kawałek, więc po niej jest pauza (`speakReply(…, intro)`).
- Kod: `speech/project-name-announcement.ts`; wybór zapisany przez wspólne
  `speech/stored-choice.ts` (na nim też „What to read”).

## Orca v1.4.243 (build 22, 2026-10-28)

**Stan: zbudowane, niepotwierdzone na telefonie.**

- Fork przeniesiony z `v1.4.229` na `v1.4.243` (scalenie, szczegóły w „Aktualizacja z upstream”).
- Nasz spinacz usunięty — załączanie plików daje teraz oficjalna Orka (plus → „Files”). Wysyłanie
  plików działa dopiero z desktopem co najmniej `v1.4.240`; nazwy plików od `v1.4.243`.
- Limit grantów trasy sesji podniesiony do 18 (przycisk „Read”).
- `build-apk.ps1`: poprawka ścieżki dla `react-native-libsodium` (nowe w `v1.4.243`) — na Windowsie
  CMake odrzucał ścieżkę z `\`.
- Wbudowana strona: 147 plików, ok. 10 MB, desktopVersion 1.4.243; protokół bez zmian (3 / min 2,
  pageVersion 1), więc działa też ze starszym desktopem — poza nowymi funkcjami, których on nie ma.

## Dźwięk przed wiadomością, „agent czeka” (build 23, 2026-10-28)

**Stan: zbudowane, niepotwierdzone na telefonie.**

Właściciel chciał krótkiego dźwięku przed czytaniem (z nazwą projektu albo zamiast niej) i
wiadomości, gdy agent stanie i czeka na niego — przy zgaszonym ekranie nie było tego słychać.

- Settings → Read aloud → **SOUND BEFORE A MESSAGE**: „Before every message” (domyślnie), „When the
  project changes” (ta sama zasada co przy nazwie projektu), „Off” (klucz `orca:voiceChime`). Wybór
  od razu gra próbkę. Kolejność: dźwięk, nazwa projektu, wiadomość. Tylko auto-czytanie.
  „Zamiast nazwy” = nazwa projektu na „Off”.
- Dźwięk to dwa miękkie tony (G5 → D6, ok. 0,4 s), cichsze od głosu, **generowane w kodzie**
  (`ReadAloudChime.kt`) — w repo nie ma pliku dźwiękowego. Gra go nasz proces (`AudioTrack`), nie
  silnik TTS jako „earcon”: silnik działa w innej aplikacji, która może nie mieć dostępu do zasobów
  Orki. Te same atrybuty (nawigacja) i fokus audio co mowa, czeka na wolny mikrofon jak mowa;
  w kolejce czytnika jest osobnym kawałkiem (`speech/reply-speaker.ts`, `playChime` w
  `speech/tts-engine.ts`). Nieudany dźwięk nie blokuje wiadomości.
- Settings → Read aloud → AUTO-READ → **„Say when an agent waits for you”** (domyślnie włączone,
  klucz `orca:voiceAnnounceWaits`). Gdy główny agent przejdzie w stan `waiting` / `blocked`, czytane
  jest raz na każde czekanie: „Agent ma pytanie.” (AskUserQuestion), „Agent prosi o zgodę.” (prośba
  o uprawnienie do narzędzia), „Agent czeka na ciebie.” (reszta) — od buildu 25 w języku
  głosu, który czyta (niżej), wcześniej według języka telefonu (polski albo angielski). Przed tym dźwięk i nazwa projektu jak przed wiadomością. Wyciszenie („Mute”) też to ucisza.
- Źródło: ten sam `worktree.ps`, który odpytuje auto-czytanie (co 3 s na ekranie, co 15 s w tle);
  stan głównego agenta (`mainAgent.state`) obejmuje też czekanie, na które trafił podagent. Jak przy
  odpowiedziach, czekanie zastane przy włączeniu auto-czytania nie jest ogłaszane.
  Kod: `speech/agent-wait-announcement.ts`.
- Treści pytania nie czytamy — `worktree.ps` jej nie niesie (tylko nazwę narzędzia).

## Wyciszanie: kafelek w szybkich ustawieniach, ikony w powiadomieniu (build 23, 2026-10-28)

**Stan: zbudowane, niepotwierdzone na telefonie.**

Właściciel uznał tekstowy przycisk „Mute / Unmute” z buildu 14 za mało elegancki (widoczny dopiero
po rozwinięciu powiadomienia) i wybrał kafelek plus ikony.

- **Kafelek „Read aloud”** w szybkich ustawieniach (`ReadAloudTileService.kt`, wpis w manifeście
  modułu), jak latarka: włączony = czyta, wyłączony = wyciszone („Muted”). Działa, póki działa usługa
  czytania (ten sam czas życia co powiadomienie, czyli przy „Keep reading with the screen off”);
  inaczej jest wyszarzony („Orca is not reading”). Dotknięcie idzie tą samą drogą co przycisk w
  powiadomieniu (`ReadAloudControls` → `onMuteToggle` → JS), wyciszenie dalej żyje w pamięci JS.
  Działa też przy zablokowanym ekranie.
- Settings → Read aloud → AUTO-READ → **„Add the Quick Settings tile”** (`speech/quick-settings-tile-row.tsx`):
  na Androidzie 13+ systemowe okno „dodać kafelek?” (`requestAddTileService`); na starszym — opis,
  jak dodać ręcznie (ołówek w panelu).
- **Powiadomienie w stylu odtwarzacza** (`Notification.MediaStyle`, bez sesji multimediów), żeby
  przyciski były ikonami widocznymi bez rozwijania: głośnik (przekreślony, gdy wyciszone) i — tylko
  podczas czytania — Stop (zdarzenie `onStopReading` → `stopSpeaking`). Czytnik zgłasza „czytam /
  nie czytam” synchronicznie z `emit()` w `speech/reply-speaker.ts` (`setSpeaking`), nie z renderu,
  żeby działało przy zgaszonym ekranie. Bez sesji multimediów Android rysuje to jak zwykłe
  powiadomienie, nie jako odtwarzacz w szybkich ustawieniach, a przyciski słuchawek i kierownicy
  zostają przy aplikacji z muzyką. **Od buildu 24** zmienione — zob. sekcja niżej: `setReaderState`
  zamiast `setSpeaking`, `onReaderControl` zamiast `onStopReading`, osobna sesja multimediów na czas
  czytania.
- Ikony: wektorowe Material Icons (`res/drawable/orca_voice_*.xml`, licencja Apache 2.0).
- Napisy (kafelek, powiadomienie) po angielsku, jak reszta interfejsu aplikacji.

## Sterowanie czytaniem, powtórka, wznawianie, słuchawki, linki (build 24, 2026-10-28)

**Stan: zbudowane, niepotwierdzone na telefonie.**

Punkty 1, 2, 3 i 5 z listy pomysłów właściciela (2026-10-28) plus jego prośba o słowo „link”.

- **Przyciski słuchawek i kierownicy** (`ReadAloudMediaSession.kt`): podczas czytania pauza /
  wznowienie, następna, poprzednia wiadomość. Android daje te przyciski sesji aplikacji, która
  ostatnio zaczęła grać dźwięk, a mowa gra w procesie silnika TTS — dlatego na starcie czytania
  gramy u siebie 0,1 s ciszy (`ReadAloudChime.silence`). Sesja istnieje tylko, gdy jest co czytać,
  i znika 10 minut po pauzie, więc potem przyciski wracają do muzyki. Wyświetlacz auta pokazuje
  nazwę projektu. Niesprawdzone, czy każde auto to respektuje.
- **Powiadomienie** (`ReadAloudService.kt`): podczas czytania Poprzednia, Pauza/Wznów, Następna
  (widoczne bez rozwijania), po rozwinięciu też Stop i głośnik; bez czytania „Powtórz” (ostatnia
  wiadomość) i głośnik. Tekst: „Reading · projekt · 2 more waiting”, „Paused…”. Powiadomienie jest
  tylko przy „Keep reading with the screen off”. W aplikacji obok Stop jest Pause / Resume.
- **Poprzednia** jak w odtwarzaczu (`speech/reader-model.ts`): po 3 s czytania wiadomość od początku,
  wcześniej (albo bez czytania) poprzednia wiadomość; przerwana wraca po niej. Historia: 10 ostatnich
  wiadomości, bez próbek z ustawień. **Pauza** trzyma kolejkę — nowe wiadomości czekają.
- **Wznawianie po rozmowie i dyktowaniu**: chwilowa utrata fokusu audio (`LOSS_TRANSIENT`) już nie
  kasuje czytania. `ReadAloudSpeech.kt` zatrzymuje mowę, ale zostawia prośbę o fokus („held”), więc
  Android oddaje go po rozmowie („regained”), a czytnik powtarza przerwany kawałek (≤ 300 znaków).
  Po więcej niż 10 minutach czytanie się kończy (wiadomość zostaje do „Powtórz”); to samo, gdy fokus
  nigdy nie wróci (`expireHolds` przy odpytywaniu). Trwała utrata (np. włączona muzyka) dalej kończy
  czytanie.
- **„Only with headphones or a car”** (Settings → Read aloud → AUTO-READ, domyślnie wyłączone, klucz
  `orca:voiceHeadphonesOnly`): auto-czytanie przez głośnik telefonu milczy (wiadomość pominięta, w
  dzienniku „skipped: no headphones”); przycisk Read czyta zawsze. Odłączenie słuchawek / auta w
  trakcie (`ACTION_AUDIO_BECOMING_NOISY`) wstrzymuje czytanie, powrót (`AudioDeviceCallback`) je
  wznawia, jeśli minęło mniej niż 10 minut. Za „prywatne” wyjście uznajemy słuchawki przewodowe, BT
  (także głośnik BT — nie da się go odróżnić od auta), USB, aparaty słuchowe, LE Audio, AUX
  (`ReadAloudOutput.kt`).
- **Linki** (Settings → Read aloud → LINKS, klucz `orca:voiceLinks`): „link” + tekst (domyślnie),
  „link” + tekst + strona (`who.int`), sam tekst (jak do buildu 23), pomijanie. Goły adres to
  „link” (z opcją strony: „link example.com”). Słowo „link” idzie przez `READER_WORDS` w
  `speech/reader-words.ts` (od buildu 25; wcześniej `PLACEHOLDERS` w `speech/speech-text.ts`). Dotyczy przycisku Read i auto-czytania.
- Kod JS: stan czytnika i akcje w `speech/reply-speaker.ts`, reguły w `speech/reader-model.ts`,
  przyciski i synchronizacja opcji w `speech/reader-controls.ts`, opcje w
  `speech/reading-preferences.ts`. Zdarzenia dźwięku z modułu: `onAudioEvent` w `speech/tts-engine.ts`.

## Słowa czytnika w języku głosu (build 25, 2026-10-28)

**Stan: zbudowane, niepotwierdzone na telefonie.**

Właściciel zauważył, że komunikat „agent czeka” źle brzmi. Słowa, które czytnik dodaje od siebie
(pominięty kod i tabela, „link”, czekanie agenta, próbka głosu), szły według języka **interfejsu
telefonu** i tylko po polsku albo angielsku, a czyta je głos w języku ustawień mowy — przy różnych
ustawieniach polski głos czytał angielskie zdanie albo odwrotnie. To też blokowało zgłoszenie
czytania do Orki (wszystko poza polskim słyszałoby angielski).

- Teraz te słowa są w języku **głosu, który czyta**: wybranego w Settings → Read aloud → Voice
  albo domyślnego głosu silnika („Phone setting”). `ReadAloudSpeech.kt` zapisuje ten język
  (`language` w SharedPreferences `orca-voice-speech`) przy starcie silnika, zmianie głosu i
  otwarciu listy głosów; JS czyta go synchronicznie z `getSpeechOptions().language`.
- Języki: te, na które przetłumaczony jest desktop Orki (angielski, chiński, japoński, koreański,
  hiszpański, francuski, portugalski), plus polski — `speech/reader-words.ts` (`READER_WORDS`).
  Głos w innym języku (np. włoski) dostaje angielski. Zanim silnik raz ruszy (pierwsze czytanie
  po instalacji), działa jak dawniej: język telefonu; wtedy też silnik jest uruchamiany w tle.
- Próbka głosu w ustawieniach jest już jednojęzyczna (wcześniej „Test czytania odpowiedzi. Test
  reading replies aloud.”).
- Zdania kończone „。！？” (chiński, japoński) nie dostają już dodatkowej kropki.
- **Bez zmian:** sama odpowiedź agenta jest czytana jednym głosem — agent piszący po angielsku do
  polskiego głosu dalej brzmi z polskim akcentem. Na to trzeba by rozpoznawać język wiadomości i
  przełączać głos (Android pozwala na głos per wypowiedź) — osobny pomysł.

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

## Wydania na GitHubie (od buildu 20, 2026-10-25)

Właściciel uznał rozsyłanie z domowego serwera za błąd: fork może być publiczny, z GitHuba pobiera
się szybko i można się tą wersją dzielić. Fork: [tomaszklin/orca-voice](https://github.com/tomaszklin/orca-voice)
(prawdziwy fork na GitHubie, gałąź domyślna `voice`).

```powershell
pwsh -File E:\Projects\OrcaVoice\voice\build-apk.ps1
pwsh -File E:\Projects\OrcaVoice\voice\publish-github.ps1
```

- `publish-github.ps1` wypycha gałąź `voice` i znacznik `voice-b<N>`, potem tworzy wydanie „Orca Voice
  build N” z plikami `orca-voice-<wersja>-b<N>.apk` i `version.json` `{build, version, file, date}`,
  oznaczone jako najnowsze. Najpierw commit, potem publikacja — znacznik idzie na bieżący commit.
- Aplikacja (`app-update/voice-build-update-source.ts`) czyta
  `https://github.com/tomaszklin/orca-voice/releases/latest/download/version.json`; adres
  `latest/download/<plik>` przekierowuje do pliku najnowszego wydania, stamtąd też pobiera APK.
- Build 19 jest na GitHubie, ale sam jeszcze pyta serwer HAL. Build 20 wystawiony też na HAL
  (ostatni raz), żeby telefony na buildach 15–19 przeszły na GitHuba same.
- **E-mail w commitach:** prywatny Gmail podmieniony przed pierwszym wypchnięciem na
  `24731628+tomaszklin@users.noreply.github.com` (na profilu GitHub właściciel e-mail ukrywa); ten
  adres jest ustawiony w `git config user.email` tego repo. Gałąź sprzed podmiany:
  `voice-before-email-rewrite` (lokalna).

## Aktualizacje z serwera domowego (build 15–19, 2026-10-21, wycofane)

Zastąpione wydaniami na GitHubie (sekcja wyżej). Build 15–19 pobierały `version.json` i APK z
domowego serwera (Home Assistant, tylko sieć domowa i VPN); skrypt `publish-apk.ps1` usunięty
2026-10-28 razem z adresami sieci domowej, które były w tym opisie (repo jest publiczne).
Mechanizm aktualizacji w aplikacji został ten sam:

- Aplikacja (`app-update/voice-build-update-source.ts`, wstawki w `app-update-runtime.ts` i
  `app-update-checker.ts`): build z numerem (`extra.voiceBuild`) pyta o `version.json` (zamiast
  wydań Orki) i porównuje numery buildów („Orca build 15 is available”).
  „Update” pobiera APK w aplikacji z postępem w powiadomieniu i otwiera systemowy instalator
  (`UpdateInstaller.kt`, `UpdateFileProvider`, uprawnienie `REQUEST_INSTALL_PACKAGES`); przy
  pierwszym razie Android prosi o zgodę na instalowanie z Orki. Sprawdzanie: raz dziennie, przy
  starcie i przyciskiem „Check for updates”.
- Oficjalnych wersji Orki aplikacja już nie zgłasza — nowy tag desktopu sprawdzać ręcznie.

## Przesłanie na telefon (ręcznie)

Telefon łączy się z komputerem przez **ZeroTier** (adres komputera w tej sieci jest w
`CLAUDE.local.md`, poza repo). Plik ma ok. 55 MB — za dużo na ntfy.

```powershell
& "C:\Program Files\nodejs\node.exe" E:\Projects\OrcaVoice\voice\serve-apk.mjs <adres-ZeroTier-komputera>
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

Fork stoi na **ostatnim wydaniu Orki** (tag `vX.Y.Z`), a desktop właściciel aktualizuje sam. Zasada
„fork na wersji desktopu z komputera” jest nieaktualna (właściciel, 2026-10-28) — protokół telefon ↔
desktop toleruje różnice wersji, a nowe funkcje Orki (np. załączniki) wymagają nowego desktopu.

1. `git fetch origin tag vX.Y.Z --no-tags`, kopia gałęzi (`git branch voice-before-X.Y.Z voice`),
   potem `git merge vX.Y.Z` — scalanie, nie przepisywanie historii, bo gałąź jest publiczna, a
   `publish-github.ps1` wypycha bez nadpisywania.
2. Konflikt w `mobile/pnpm-lock.yaml` → wziąć wersję z tagu i `pnpm install --no-frozen-lockfile`
   w `mobile/` (z `pnpm_config_node_linker=hoisted`); doda tylko `expo-speech`.
3. Sprawdzić limit grantów trasy sesji (sekcja o przycisku „Read”) i przeniesione pliki Orki
   (`tsc --noEmit -p tsconfig.json` w `mobile/`).
4. Testy: `node node_modules/vitest/vitest.mjs run src/speech src/settings src/session
   src/mobile-web-shell src/platform src/app-update src/transport` w `mobile/`.
5. `pwsh -File voice\build-apk.ps1`, potem `voice\publish-github.ps1` (telefon dostanie aktualizację w aplikacji).

Historia: 2026-10-28 z `v1.4.229` na `v1.4.243` (kopia: `voice-before-1.4.243`, lokalna).

Uwaga: oficjalne APK Orki zainstalowane na tę wersję usuwa czytanie (wraca oryginał).

## Testy — stan 2026-10-18 (build 4)

Zmiany forka mają testy w `src/speech/*.test.ts`; zaktualizowane listy grantów w
`page-route-policy.test.ts` i `bridge-host-init.test.ts`; przycisk Read jest zamockowany globalnie
w `vitest.setup.ts`, żeby nie ruszać mocków w testach czatu Orki. Testy czatu, mostka, ustawień i
mowy przechodzą. Na tym Windowsie **niezależnie od zmian** (sprawdzone na czystym tagu) nie
przechodzi 70 testów w `rpc-recording/*` i `native-document-bundle` oraz kilka plików, którym
brakuje zależności głównego workspace'u (`zod`, `oxc-parser`…). `tsc --noEmit`: 7 błędów, wszystkie
w plikach spoza zmian (brak tych samych zależności).