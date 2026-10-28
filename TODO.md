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

### Etap 5: rozmowa z Capri przez Tailscale (zamiast Telegrama)
- Telefon z aplikacją Tailscale otwiera stronę czatu Capri (PWA) na jej adresie w sieci Tailscale (HTTPS z certyfikatem
  `*.ts.net`): treść nie przechodzi przez żaden obcy serwer.
- Parowanie telefonu raz, w Mainframe: Capri zapamiętuje jego urządzenie w Tailscale (`whois`) i klucz w przeglądarce.
  Obce urządzenie z tej samej sieci Tailscale nie wejdzie, nawet z twojego konta.
- Bez kodów TOTP do rozmowy: dostęp wymaga fizycznie tego telefonu (odblokowanego, z zalogowanym Tailscale), a nie
  konta, które da się przejąć zdalnie. Do zadań z narzędziami (jak etap 3 Telegrama): potwierdzenie odciskiem palca
  (passkey, WebAuthn) zamiast kodu.

## Do zrobienia

- Okno czatu na pulpicie, zsynchronizowane z czatem Capri (ta sama rozmowa w obu miejscach).
- Przerobienie okna Mainframe.
- Ograniczenie menu pod prawym przyciskiem myszy.
- Głos klonowany z postaci z anime albo z własnego nagrania.
- Zróżnicowane komentarze Capri do podejmowanych akcji (mniej powtórzeń tych samych tekstów).
- Równoległe monitorowanie różnych AI naraz.
- Komunikacja z Hermesem.
- Do decyzji: telefon parowany raz dla całego roju. Komputery same przekazują sobie token bota i sekret TOTP
  (zaszyfrowanym kanałem roju, tylko między twoimi urządzeniami, na każdym zapisane kontem Windows), więc każdy
  może przejąć telefon i działa jeden kod w aplikacji uwierzytelniającej. Za: parowanie raz, telefon działa, nawet
  gdy komputer z botem jest wyłączony. Przeciw: token trafia na każdy komputer roju, więc przejęcie któregokolwiek
  daje dostęp do bota (dziś tylko komputera, na którym go sparowano).
- Aktualizacje: zmiana repozytorium (i gałęzi), z którego Capri się aktualizuje, z poziomu Mainframe
  (dziś: `origin` klonu, ustawiany przez `install.ps1 -Repo`).
- Aktualizacje: Capri z instalatora oryginalnego projektu (`Capri-Setup-x.y.z.exe`, nie klon gita) tylko informuje
  o nowej wersji i odsyła do strony Releases.
