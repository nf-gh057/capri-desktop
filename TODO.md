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

## Rój: jedna Capri na kilku komputerach (przez Tailscale)

Komputery w różnych miejscach i sieciach (Wi-Fi, LAN, sieć komórkowa, zmienne IP). Łączy je Tailscale: prywatna,
szyfrowana sieć WireGuard ze stałym adresem `100.x.y.z` dla każdego urządzenia, która sama przebija się przez NAT,
a gdy nie może, idzie przez przekaźniki (widzą tylko szyfr). Bez serwera Capri i bez otwierania portów w internecie.
Konto Tailscale i logowanie na każdym urządzeniu robi użytkownik; wszystko inne ustawia się w Mainframe.

Wspólne dla wszystkich etapów:
- Każda Capri ma własny klucz (X25519, prywatny zaszyfrowany DPAPI). Parowanie kodem pokazanym w Mainframe jednego PC
  i wklejonym w Mainframe drugiego; potem każda para ma własny klucz i szyfruje wiadomości (AES-256-GCM) niezależnie
  od WireGuarda, ze znacznikiem czasu i jednorazowym numerem (bez powtórek). Nowy komputer poznaje resztę roju od tego,
  z którym się sparował.
- Nasłuch tylko na adresie Tailscale (i 127.0.0.1), nigdy na LAN-ie ani w internecie.
- Inne komputery przysyłają tylko stan, obecność, zdarzenia i pamięć: nigdy poleceń do wykonania. Przejęty laptop
  nie uruchomi niczego na pozostałych.

### Etap 1: obecność i przeskok (zrobione: `src/main/swarm.js`, Mainframe › RÓJ, `install.ps1 -Tailscale`)
- Co kilka sekund każdy komputer mówi pozostałym: czy ekran jest zablokowany i ile sekund minęło od klawiatury
  lub myszy. Aktywny: odblokowany, z najświeższym ruchem (z zapasem, żeby nie skakała tam i z powrotem).
  Zablokowany ekran albo brak odpowiedzi przez kilkanaście sekund: nie ma cię tam.
- Capri jest widoczna tylko na aktywnym; gdzie indziej chowa się do biochipa. Bez sieci: wyspa, jest u siebie,
  myśli przez Ollamę.
- Mainframe › RÓJ: ten komputer, Tailscale (jest / zainstaluj), lista komputerów z ich stanem, dodaj, dołącz, usuń.

### Etap 2: zdarzenia agentów z całego roju
- Claude Code / Codex na laptopie skończył: Capri przy biurku mówi o tym; raport z misji z wszystkich komputerów.

### Etap 3: świadomość zbiorowa
- Wspólne: rozmowy i pamięć (imię, „zapamiętaj”, jej opis), więź i nastrój, przypomnienia. Lokalne: ekran, rozmiar,
  hooki, model AI.
- Zmiany ze znacznikiem czasu i komputera; po powrocie wyspy do sieci scalanie bez gubienia: rozmowy po czasie,
  wspomnienia i przypomnienia jako suma (z usunięciami), więź jako suma przyrostów. Capri komentuje powrót.

### Etap 4: telefon w roju
- Bota Telegrama czyta tylko jeden komputer naraz (lider roju); „nie ma cię” = przy żadnym komputerze.

### Etap 5: rozmowa z Capri przez Tailscale (zamiast Telegrama)
- Telefon z aplikacją Tailscale otwiera stronę czatu Capri (PWA) na jej adresie w sieci Tailscale (HTTPS z certyfikatem
  `*.ts.net`): treść nie przechodzi przez żaden obcy serwer.
- Parowanie telefonu raz, w Mainframe: Capri zapamiętuje jego urządzenie w Tailscale (`whois`) i klucz w przeglądarce.
  Obce urządzenie z tej samej sieci Tailscale nie wejdzie, nawet z twojego konta.
- Bez kodów TOTP do rozmowy: dostęp wymaga fizycznie tego telefonu (odblokowanego, z zalogowanym Tailscale), a nie
  konta, które da się przejąć zdalnie. Do zadań z narzędziami (jak etap 3 Telegrama): potwierdzenie odciskiem palca
  (passkey, WebAuthn) zamiast kodu.

## Aktualizacje: Capri sama sprawdza, czy na GitHubie jest nowa wersja

Capri zainstalowana skryptem `install.ps1` to klon gita (`%LOCALAPPDATA%\Capri\capri-desktop`), więc może się
zaktualizować tak jak ponowne uruchomienie instalatora: `git pull` i pakiety.

- Skąd: repozytorium i gałąź z `origin` jej klonu (u nas `nf-gh057/capri-desktop`, `main`), do zmiany w Mainframe;
  nic na sztywno w kodzie.
- Sprawdzanie: przy starcie i co kilka godzin. Najtańsze: `package.json` z GitHuba (raw) i porównanie wersji `x.y.z-n`
  z `app.getVersion()`; dokładniej: `git fetch` i porównanie commitów (`HEAD` i `origin/main`). Bez sieci: ciche
  pominięcie, następna próba później.
- Gdy jest nowa: Capri mówi o tym raz (w swoim stylu), Mainframe pokazuje wersję i listę zmian (tytuły commitów od
  obecnej) oraz przycisk „Zaktualizuj”. Do wyboru w Mainframe: tylko powiadamiaj (domyślnie) / aktualizuj sama, kiedy nie
  ma cię przy komputerze.
- Aktualizacja: `git pull --ff-only`, `npm ci` tylko gdy zmienił się `package-lock.json` (i Electron, gdy brakuje
  binarki), potem `app.relaunch()`. Odmowa (z powodem w Mainframe), gdy klon ma lokalne zmiany, jest na innej gałęzi albo
  się rozjechał z GitHubem; nigdy `reset --hard`. W trybie `--dev` (klon programisty) tylko informacja, bez aktualizacji.
- Gdy coś pójdzie nie tak: powrót do poprzedniego commita (`git reset --keep` na zapamiętany) i ponowne `npm ci`.
- Bezpieczeństwo: tylko HTTPS z GitHuba i tylko po kliknięciu (albo po świadomym włączeniu trybu automatycznego);
  aktualizacja uruchamia kod z repozytorium (tak jak instalator), więc nigdy z adresu podanego przez stronę, Telegram
  czy inny komputer roju.
- Rój: komputery mówią sobie swoją wersję; Mainframe pokazuje, który jest starszy, a różne wersje protokołu roju nie
  psują połączenia (komputer ze starszą wersją dostaje informację, że trzeba go zaktualizować).
- Capri z instalatora autora (`Capri-Setup-x.y.z.exe`, nie klon) tylko informuje o nowej wersji i odsyła do Releases.
