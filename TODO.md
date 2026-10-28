# TODO

## Capri na telefonie przez Telegram (bot, w trzech etapach)

Jeden bot na Telegramie. Każdy użytkownik zakłada własnego (u @BotFather) i podłącza go w Mainframe:
token, parowanie z telefonem i wszystkie ustawienia są w oknie, nic na sztywno w kodzie.
Telegram zamiast Discorda: zwykłe HTTPS na zewnątrz (bez otwartego portu, bez webhooka), bot w minutę,
a tokeny sesji Discorda to główny łup programów kradnących hasła.

Wspólne dla wszystkich etapów:
- Token bota zaszyfrowany (DPAPI, jak klucze API w `setup.js`); nigdy nie trafia do logów.
- Parowanie jednorazowym kodem pokazanym tylko w Mainframe (`/start <kod>` w czacie z botem):
  zapamiętane ID użytkownika i prywatnego czatu, grupy i obcy ignorowani.
- Włączane świadomie (opt-in): README obiecuje, że nic nie opuszcza komputera. Wybór, ile treści
  wychodzi (sama jej kwestia i projekt / z fragmentem promptu lub odpowiedzi; nigdy zawartość plików).
- Limit wiadomości na minutę; długie teksty przycinane, wiersze wyglądające na klucze zamazywane.
- Bez zatwierdzania zgód Claude/Codex z telefonu: przejęty Telegram nie może oznaczać wykonania kodu na PC.

### Etap 1: powiadomienia w jedną stronę (zrobione: `src/main/phone.js`, sekcja TELEFON w Mainframe)

- Kiedy jestem z dala od komputera (kilka minut bez ruchu albo zablokowany ekran; do wyboru w Mainframe,
  albo zawsze): Claude/Codex czeka na zgodę lub odpowiedź, zadanie się skończyło, błąd, wieczorny raport.
- Wiadomości w jej stylu (`lines.js`, wszystkie języki), np. „Choom, zerknij na Codex, chyba ogarnął
  ostatni gig i się nudzi”.
- Bot niczego nie przyjmuje poza kodem parowania: bez kodu TOTP, bo nic nie wchodzi.
- Mainframe: link do @BotFather, pole na token, parowanie, włącz/wyłącz, kiedy, ile treści, test, odłącz.

### Etap 2: rozmowa z Capri na Telegramie (zrobione: `src/main/totp.js`, nasłuch w `phone.js` i `main.js`)

Zrobione tak: odblokowanie na 1, 4 albo 8 h (wybór w Mainframe); każdy kod działa raz, wiadomość z kodem jest kasowana;
Claude Code z telefonu ma tylko Read, Grep i Glob, bez serwerów MCP; Codex w piaskownicy tylko do odczytu, bez sieci.
Przyciski: „przypomnij za 30 min” (wysyła to samo jeszcze raz) i „cisza na godzinę”.

- Ta sama rozmowa i pamięć co czat na pulpicie, bez jej „mocy” (żadnych aplikacji, stron, muzyki).
- Odblokowanie kodem TOTP z aplikacji uwierzytelniającej (`/unlock 123456`) na dłużej, np. 8 h;
  wygasa po powrocie do komputera albo po godzinie ciszy. Sekret TOTP zaszyfrowany, kod QR tylko w Mainframe.
  Po 3 błędnych kodach zdalne sterowanie wyłączone do ponownego włączenia przy komputerze.
- Codex w trybie „tylko odczyt” dalej czyta cały dysk, dlatego rozmowa też wymaga kodu.
- Przyciski pod powiadomieniami (np. „przypomnij za 30 min”) bez kodu: niczego nie wykonują.
- Long polling `getUpdates` tylko wtedy, gdy etap jest włączony; `/lock` od razu blokuje.

### Etap 3: zadania przez Codex z narzędziami

- Świeży kod TOTP, odblokowanie na krótko (np. 30 min).
- Tylko w folderach dopisanych do listy przy komputerze; sandbox `workspace-write` ograniczony do folderu,
  bez sieci, zgody „never”; nigdy `danger-full-access`. Przed zadaniem sprawdzenie, że sandbox Windows
  jest gotowy (`windowsSandbox/readiness`), inaczej odmowa.
- `/stop` przerywa zadanie, wyłącznik w zasobniku i w Mainframe wyłącza wszystko.
- Raport po powrocie do komputera: co zrobiono zdalnie, zmienione pliki, nieudane próby odblokowania.
- Ryzyko, które zostaje: prompt injection z plików czytanych przez agenta (ograniczone brakiem sieci,
  folderem i limitem odpowiedzi); Telegram widzi treść zadań (czaty z botem nie są szyfrowane end-to-end).
