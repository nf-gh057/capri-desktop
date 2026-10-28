# Capri: fork `nf-gh057/capri-desktop`, zasady pracy

Ten plik czyta każda sesja Claude Code w tym repozytorium, na każdym komputerze. Jak skonfigurować nowy komputer do
pracy nad Capri: `docs/ROZWOJ.md`.

## Rozmowa

- Z użytkownikiem po polsku. Kod, komentarze, commity i `README.md` po angielsku; `README.pl.md` i `TODO.md` po polsku.

## Repozytoria i pull requesty

- `origin` = fork `nf-gh057/capri-desktop` (tu idzie każdy push). `upstream` = repozytorium autora oryginału
  `mochiiwuff/capri-desktop`, z zablokowanym wysyłaniem (`git remote set-url --push upstream DISABLED`).
- **Żadnych pull requestów** do autora i żadnych propozycji ich wysłania.
- **Po każdym pushu**: `git fetch upstream`, potem `git log main..upstream/main` i `git diff main...upstream/main --stat`.
  Jeśli autor dodał coś nowego, powiedz użytkownikowi, co się zmieniło (commity, obszary, wpływ na nasze zmiany:
  zwłaszcza nowe kwestie w `src/renderer/js/lines.js` bez `pl` i zmiany w `src/main/bridge.js` albo `hooks/`, które
  mogłyby cofnąć zabezpieczenie tokenem). **Nie scalaj sam**: zgłoś i zapytaj. Gdy nic nowego, jedno zdanie.
- Scalanie upstreamu (gdy użytkownik o nie poprosi): `README.fr.md` zostaje usunięty (`git rm`), zmiany autora
  w `README.md` przenieś też do `README.pl.md` (przetłumaczone); zachowaj w `README.md` sekcję o forku i opis
  instalatora. Po scaleniu testy i sprawdzenie na żywo, dopiero potem push.

## Wersje i commity

- Wersja to wersja autora plus numer naszego commitu na niej: `0.4.4-1`, `0.4.4-2`…; numer wraca do `-1`, gdy autor
  podniesie swoją wersję. **Przed każdym commitem** (scalenia też) `npm run bump` (`scripts/version.js` czyta wersję
  z `upstream/main`) i commit razem z `package.json` i `package-lock.json`. Konflikt w `package.json` przy scalaniu:
  weź dowolną stronę, potem `npm run bump`.
- Autor commitów: `git -c user.name=nf-gh057 -c user.email=54669248+nf-gh057@users.noreply.github.com commit …`.
- Wiadomość: pierwsza linia `0.4.4-N: co się zmieniło, z punktu widzenia użytkownika` (po angielsku), potem krótki
  opis jak i dlaczego, na końcu `Co-Authored-By` modelu.
- Commituj i pushuj, gdy użytkownik o to prosi albo gdy kończysz zleconą funkcję, którą sprawdziłeś.
- **Nie commituj cudzej pracy**: jeśli w drzewie są niezacommitowane zmiany, których nie robiłeś, weź do commita tylko
  swoje fragmenty (np. łatka z twoich hunków i `git apply --cached`) i powiedz o tamtych użytkownikowi.

## Gałęzie

- Prace nad animacjami i pozami Capri: gałąź `anim/poses` w osobnym worktree `../capri-anim`, nigdy w `capri-desktop`.
  W `capri-desktop` nie przełączaj gałęzi: zostaje na `main`.

## Jak budować funkcje

- **Wszystko dla nowego użytkownika ustawia się w Mainframe** (okno ustawień, `src/renderer/js/mainframe.js`
  i `mainframeState`/`mainframeAct` w `src/main/main.js`): Claude, Codex, Telegram, rój, aktualizacje… Nic nie jest
  zaszyte w kodzie pod jednego użytkownika.
- **Każdy nowy tekst w 6 językach**: fr, en, es, pt, ru, pl. Etykiety Mainframe, menu i bota: `src/main/labels.js`;
  kwestie Capri: `src/renderer/js/lines.js`. Sprawdź, że każdy język ma każdy klucz.
- O autorze oryginału (mochiiwuff) i o każdej osobie, której zaimków nie znasz: neutralnie (nie „autorka”, nie „her”),
  np. „oryginalny projekt”.
- Styl kodu jak w otoczeniu: komentarze opisowe, w głosie projektu („she…”), tam gdzie coś nie jest oczywiste.
- Dokumentacja: każda funkcja trafia do `README.md` i `README.pl.md`; plany i etapy do `TODO.md` (zrobione oznaczaj
  „(zrobione: …)”).

## Bezpieczeństwo (decyzje użytkownika)

- Telefon (Telegram) nigdy nie zatwierdza zgód Claude Code ani Codexa: przejęty Telegram nie może oznaczać
  wykonania kodu na PC. Rozmowa przez Telegram wymaga kodu TOTP; agenci odpowiadający z telefonu tylko czytają
  (Codex w piaskownicy tylko do odczytu, Claude Code tylko Read/Grep/Glob, bez MCP).
- Tokeny, klucze i sekrety szyfrowane kontem Windows (`setup.sealKey`/`openKey`), nigdy w logach ani w configu
  przekazywanym do nakładki (`rendererConfig`).
- Rój: inne komputery przysyłają tylko stan, zdarzenia agentów (okrojone) i wspólną pamięć, nigdy polecenia do
  wykonania; nasłuch tylko na adresie Tailscale i `127.0.0.1`; dołączenie bez kodu tylko dla urządzeń na tym samym
  koncie Tailscale.
- Nie wpisuj za użytkownika tokenów, haseł ani danych logowania (bot u @BotFather, konto Tailscale, GitHub): to robi on.

## Testy i sprawdzanie

- Testy: `npm run test:hooks`, `test:phone`, `test:swarm`, `test:update`, `test:mind`; przed commitem wszystkie.
- Na żywo: Capri w trybie `--dev` ma trasy `/debug/*` na `127.0.0.1:47823` (nagłówek `x-capri-token` z
  `~/.capri/bridge-token`): `eval` (nakładka), `mainframe` (`{ act, value }`, `{ js }` w stronie, `{ capture, scroll }`),
  `capture`, `command`, `swarm` (`{ locked, idle }`, `{ island: true|false }`), `reload`.
- Druga Capri na tym samym PC: `CAPRI_PROFILE`, `CAPRI_PORT`, `CAPRI_SWARM_PORT`, `CAPRI_TOKEN_FILE` (osobne wartości),
  `CAPRI_SWARM_LOOK` (adresy innych Capri do znalezienia). Fałszywy Telegram: `CAPRI_TELEGRAM_API`. Brak sieci:
  `CAPRI_OFFLINE=1`. Aktualizacja w klonie dev: `CAPRI_UPDATE_DEV=1`.
- **Nie ruszaj prawdziwej konfiguracji użytkownika** (`%APPDATA%\capri-desktop`): testy na osobnych profilach; jeśli
  już trzeba, kopia przed i przywrócenie po. Testowe profile i tokeny usuń po teście. Dane testowe wpisuj przez samą
  Capri (`/debug/eval` z `host.setConfig`, `host.chatRemember`), nie plikami.
- Po zmianach w `src/main` uruchom Capri dev ponownie (`/debug/mainframe` z `{ "act": "quit" }`, potem `npm run dev`).

## Pliki i środowisko

- Końce linii LF; `*.cmd` CRLF (`.gitattributes`). `install.ps1` tylko ASCII (PowerShell 5.1).
- Edycje z polskimi znakami albo `\n` w treści: narzędziem Write/Edit albo skryptem zapisanym tym narzędziem, nie
  heredokiem w bashu (psuje znaki spoza ASCII i sekwencje ucieczki).
