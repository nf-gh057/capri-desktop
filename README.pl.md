[English](README.md) · **Polski**

# Capri: fork nf-gh057

To jest fork [mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop), na bieżąco z oryginałem. Na
górze tej strony: co fork dokłada i jak go zainstalować. Niżej README oryginalnego projektu, przetłumaczone bez zmian:
wszystko, co opisuje, jest też w tym forku.

## Co dokłada ten fork

- **Mainframe**: jej okno, w stylu menu z gry, z jej czatem i wszystkimi ustawieniami.
- **Jej czat**, w którym szybko odpowiada Claude Code albo Codex, i który działa dalej bez sieci.
- **Jej telefon**: wiadomości i rozmowa przez twojego własnego bota na Telegramie.
- **Rój**: jedna Capri na wszystkich twoich komputerach.
- **Polski**: mówi po polsku i rozumie polski w czacie.
- **Instalator w jednej linijce** dla Windows i **aktualizacje**, które robi sama z GitHuba.
- Drobniejsze rzeczy, wypisane niżej.

### Mainframe

Prawy klik na niej › **Ustawienia…**. Okno jak menu z gry: zmienisz mu rozmiar, zmaksymalizujesz je i zadokujesz do
krawędzi, a ono pamięta, gdzie je zostawiłeś, jego rozmiar i zakładkę, na której byłeś.

- **U góry**, jak poziom i street cred w grze: jej poziom, synchronizacja z tobą i dni razem. Pośrodku są zakładki. Po
  prawej, jak zdrowie i pieniądze w grze: model odpowiadający w jej czacie i AI, którego pilnuje (SPOCZYNEK, gdy tylko
  dotrzymuje ci towarzystwa).
- **Lewy dolny róg**: MAINFRAME i jej wersja. **Prawy dolny róg**: **?** (albo F1) pokazuje wszystkie zakładki i to, do
  czego służą. To samo widać po najechaniu na zakładkę.

| Zakładka | Co w niej jest |
|---|---|
| **HOLO** | Jak wiadomości w grze. **CAPRI**: jej czat, ta sama rozmowa co w jej panelu (i na Telegramie); możesz do niej pisać także stąd. Jej odpowiedź pojawia się na bieżąco, a to, o co prosisz wprost (przypomnienie, muzyka, aplikacja z nazwy), się dzieje. Obok jest wszystko inne, co ci powiedziała na tym komputerze: Claude, Codex, przypomnienia, twój komputer. Nie ma tu drobnych tekstów z animacji (gwiazda, satelita, rzucanie nią). **TELEGRAM**: twój telefon. |
| **NETWATCH** | Kto odpowiada w jej czacie (model na twoim PC, w sieci albo Claude Code / Codex) i co pokazuje czat. Asystent, którego pilnuje w terminalu, i jego hooki. Gdy w czacie odpowiada Claude Code albo Codex: jego folder, uprawnienia, jak długo myśli Codex i **Blackwall Gateway**, czyli jej własne moce razem z nim (aplikacje, strony, muzyka). |
| **ENGRAMS** | Wasza więź, jej persona, przypomnienia i to, co pamięta, z komputerem, na którym to powiedziałeś. |
| **RELIC** | Jej ciało (rozmiar, gdzie odpoczywa, ekran, skrót do chowania, jak się zachowuje) i jej rój. |
| **CYBERDECK** | Język, animacje, sposób rysowania, menu, start z Windows, jej aktualizacje, pomoc, wyjście. |

To, co powiedziała, HOLO trzyma w `holo.json` (ostatnie 300 kwestii), tylko na tym komputerze.

### Jej czat: Claude Code, Codex i bez sieci

- **Claude Code**: kiedy rozmawiacie, działa jeden Claude Code, który zamyka się po 15 minutach bez użycia. Nie czekasz
  na nowy przy każdej wiadomości. Jej słowa pojawiają się na bieżąco, a odpowiedź jest gotowa, gdy tylko Claude Code ją
  skończy: przy krótkiej to sekunda, dwie.
- **Codex**, zalogowany planem ChatGPT: kiedy rozmawiacie, działa jeden `codex app-server`. Startuje, gdy otwiera się jej
  czat, zamyka się po 15 minutach bez użycia, a jej słowa pojawiają się na bieżąco. Pracuje w wybranym folderze, tylko do
  odczytu albo z prawem do edycji (`workspace-write`), i pamięta rozmowę po restarcie. **Rozumowanie Codex** (low,
  medium, high) wymienia szybkość na namysł: low odpowiada w kilka sekund.
- **Blackwall Gateway** (Mainframe › NETWATCH): kiedy odpowiada Claude Code albo Codex, decyduje, czy Capri dalej sama
  otwiera aplikacje, strony, muzykę i pliki. Gdy jest wyłączona, agent robi to po swojemu. Przypomnienia, twoje imię
  i „zapamiętaj” działają tak czy inaczej.
- **Nie ma sieci?** Kiedy jej mózg siedzi w sieci (Codex, Claude Code, usługa z kluczem, model Ollamy w chmurze), utrata
  sieci zostawiłaby ją bez jednej myśli. Z **[Ollamą](https://ollama.com) i modelem na twoim PC** (gemma3 to dobry
  wybór; instalator ją dokłada) odpowiada za nią model z twojego PC, jako ona. Potrafi mniej (bez narzędzi Codexa czy
  Claude Code, mniejszy model), a linijka pod odpowiedzią o tym mówi. Ładuje się, gdy tylko sieć zniknie, więc jej
  pierwsza odpowiedź na niego nie czeka.
- Nagłówek jej czatu podaje model, który odpowiada, a linijka pod czatem mówi, że odpowiada AI, na twoim PC albo w sieci.
  Mainframe może ukryć jedno i drugie.

### Jej telefon (Telegram)

- **Wiadomości na telefon** przez twojego własnego bota na Telegramie, kiedy nie ma cię przy komputerze: gdy Claude albo
  Codex cię potrzebuje, kończy albo się wysypuje, i jej wieczorny raport.
- **Rozmowa przez Telegram**: ta sama rozmowa i pamięć, z telefonu. Odblokowuje ją kod z aplikacji uwierzytelniającej
  (`/unlock 123456`). Stamtąd Capri nie ma swoich mocy, a Claude Code i Codex tylko czytają.

Wiadomości na telefon są wyłączone, dopóki nie założysz własnego bota na Telegramie (u @BotFather) i nie sparujesz go
w Mainframe › HOLO › TELEGRAM, kodem, który pokazuje tylko to okno. Potem, kiedy nie ma cię przy PC (kilka minut bez
klawiatury i myszy albo zablokowany ekran), wysyła na ten jeden czat:

- swoją kwestię;
- nazwę projektu;
- jeśli tak wybierzesz, fragment promptu albo odpowiedzi: najwyżej 400 znaków, a wszystko, co wygląda na klucz,
  zamazane.

Idzie to przez serwery Telegrama, a czaty z botem nie są szyfrowane end-to-end. Nigdy nie wysyła twoich plików. Token
bota jest zaszyfrowany twoim kontem Windows, a jedyne, co Capri kiedykolwiek czyta od bota, to ten kod parowania.

Rozmowa przez Telegram jest wyłączona, dopóki nie włączysz jej w Mainframe. Potrzebna jest do tego aplikacja
uwierzytelniająca (Google albo Microsoft Authenticator, Aegis, 2FAS…). Jej sekret widać tam raz, jako kod QR. Jest
zaszyfrowany jak token i zostaje zapisany dopiero wtedy, gdy pierwszy kod z aplikacji się zgodzi.

- Bot słucha wtedy tylko twojego sparowanego czatu. Nikomu innemu nawet nie odpowiada.
- Nic, co wyślesz, nie dociera do niej przed `/unlock 123456`. Każdy kod działa raz, a wiadomość z nim jest kasowana.
- Odblokowanie trwa 1, 4 albo 8 godzin. Kończy się wcześniej, gdy wracasz do komputera, po godzinie ciszy, przez `/lock`
  albo z Mainframe.
- Trzy złe kody z rzędu wyłączają rozmowę, dopóki nie włączysz jej z powrotem przy komputerze.
- Stamtąd Capri rozmawia bez swoich mocy: niczego nie otwiera, nie gra, nie przypomina. Claude Code i Codex tylko czytają,
  cokolwiek pozwala im Mainframe na pulpicie: Codex w piaskownicy tylko do odczytu, Claude Code z samymi narzędziami do
  czytania (bez powłoki, edycji, sieci i serwerów MCP).
- Twoje wiadomości i jej odpowiedzi idą przez serwery Telegrama i do tej samej pamięci co jej czat przy komputerze.
- Przyciski pod jej wiadomościami („przypomnij za 30 min”, „cisza na godzinę”) nie wymagają kodu: zmieniają tylko to, co
  ci wysyła.

### Rój

Jedna Capri na wszystkich twoich komputerach: w domu, w pracy, na laptopie w sieci komórkowej. Łączą się przez
[Tailscale](https://tailscale.com), prywatną sieć (WireGuard). Każde twoje urządzenie ma w niej jeden adres
(`100.x.y.z`), niezależnie od sieci, i samo przechodzi przez domowe routery i sieci komórkowe.

**Konfiguracja**

1. Zainstaluj Tailscale i zaloguj się na każdym komputerze tym samym kontem. Do użytku prywatnego jest za darmo, a
   `install.ps1 -Tailscale` go instaluje.
2. W Mainframe › **RELIC** włącz rój na każdym komputerze.
3. Pod **Twoje urządzenia z Capri** każdy komputer pokazuje pozostałe, które znajdzie w twojej sieci Tailscale.
   **Dołącz** je łączy, bez przepisywania czegokolwiek: Tailscale poświadcza, że oba są twoje (to samo konto), a
   urządzenie z innego konta zostaje tam odrzucone.
4. Dla urządzenia z innego konta: kliknij **Dodaj komputer** na jednym, a linijkę, którą pokaże, wklej w **Dołącz** na
   drugim. Działa raz, przez 10 minut.

Komputer, który dołącza, poznaje resztę roju od tego, do którego dołączył. Zainstalowany skryptem rój sam się
aktualizuje: gdy jeden komputer ma nowszą Capri, pozostałe sprawdzają GitHuba i aktualizują się, gdy tylko nie siedzisz
przy nich. Nigdy nie dzieje się to w trakcie odpowiedzi (**Aktualizuj razem z rojem**, domyślnie włączone).

**Na którym komputerze jest**

Co kilka sekund każdy komputer mówi pozostałym, czy ma zablokowany ekran i ile minęło od klawiatury lub myszy. Capri jest
na odblokowanym, którego używałeś ostatnio, a na pozostałych chowa się do biochipa. Inny komputer musi być wyraźnie
świeższy, żeby przeskoczyła. Komputer, który przez kilkanaście sekund nie odpowiada, liczy się jako ten, przy którym cię
nie ma. Komputer sam, bez sieci, ma ją dla siebie.

**Bezpieczeństwo**

- Każda Capri ma własny klucz. Każda para komputerów ma wspólny klucz wyliczony z ich kluczy, który nigdy nie jest
  wysyłany.
- Wszystko między dwoma komputerami jest nim szyfrowane (AES-256-GCM, ze znacznikiem czasu i jednorazowym numerem,
  którego nie da się powtórzyć), na szyfrowaniu samego Tailscale.
- Nasłuchuje tylko na swoim adresie Tailscale (i `127.0.0.1`), nigdy w sieci lokalnej ani w internecie, i tylko
  sparowanych komputerów.
- Komputery przysyłają swój stan i to, co robią ich agenci do programowania, nigdy coś do uruchomienia.

**Co trafia do komputera, przy którym jesteś**

To, co Claude Code albo Codex robi na komputerze, przy którym cię nie ma, trafia do tego, przy którym jesteś. Capri mówi
ci o tym tam, z nazwą komputera przy projekcie („projekt-x · laptop”). Komputer, od którego odszedłeś, milczy. Między
komputerami idzie tylko to, co czyta jej mózg: zdarzenie, przycięte teksty i wejście narzędzia jeden poziom w głąb.
Wynik narzędzia ani zawartość pliku nigdy nie idą.

**Jeden umysł na wszystkich**

Na każdym komputerze to samo jest: wasze rozmowy, **Zapomnij nasze rozmowy**, twoje imię, to, jaka ma być, to, co
kazałeś jej zapamiętać, jej przypomnienia i wasza więź. Ekran, rozmiar, hooki i AI zostają osobne dla każdego komputera.

- Każda zmiana jest zapisywana z czasem i komputerem.
- Dwa komputery wymieniają się tylko tym, czego drugi jeszcze nie widział. Wygrywa nowsza zmiana, a usunięte zostaje
  usunięte.
- Komputer bez sieci działa sam, a gdy wraca, nadrabia zaległości, i Capri o tym mówi.
- Przypomnienie odzywa się raz, na komputerze, przy którym jesteś.

To, jaka jest i co pamięta, trafia też do Claude Code albo Codexa, kiedy odpowiadają w jej czacie. Dlatego gdy inny
komputer zmieni jej personę albo wspomnienia, Capri mówi ci o tym na komputerze, przy którym jesteś, pokazuje, co się
zmieniło, i daje **Cofnij**. Cofnij przywraca poprzedni stan na wszystkich.

**Telefon**

Sparuj bota Telegrama na jednym komputerze, a pozostałe wysyłają swoje wiadomości przez niego. „Nie ma cię” znaczy wtedy:
nie ma cię przy żadnym z nich, a rozmowa przez Telegram blokuje się, gdy wrócisz do któregokolwiek.

### Drobniejsze rzeczy

- **Polski**: mówi po polsku i rozumie polski w czacie (przypomnienia, muzyka, pliki…). Także `npm run demo -- pl`.
- **Jej skrót** (Ctrl+Alt+C) da się zmienić: inny, taki, który naciśniesz, albo żaden. Na polskiej klawiaturze
  Ctrl+Alt+C to AltGr+C, czyli „ć”.
- **Kilka ekranów**: z wyłączonym *Chodź za mną z ekranu na ekran*, kręcąc się, od czasu do czasu teleportuje się na
  inny ekran.
- **Okno, w którym pracujesz**: nie unosi się i nie przesiaduje przed nim, a po chwili schodzi z drogi. Siedzieć na jego
  krawędzi albo je opętać może dalej.
- **Gdzie jest Claude?** Znajduje jego okno także zmaksymalizowane i pamięta je po swoim restarcie.
- **Dowolne okno, z czatu**: „gdzie jest notatnik?”, „pokaż okno Spotify”, „where's Notepad?”. Pokazuje je palcem,
  a jeśli jest zminimalizowane albo przykryte, najpierw wyciąga je na wierzch. Nazwy działają w każdym z jej języków
  („notatnik”, „bloc-notes” i „блокнот” znajdują Notatnik, „przeglądarka” dowolną przeglądarkę), a po polsku także
  odmienione („okno discorda”). Gdy otwarte jest tylko coś podobnego (literówka, inna nazwa), pyta po swojemu, czy
  o to ci chodziło. Gdy nic nie jest otwarte, proponuje, że to uruchomi (po twoim kliknięciu). Tytuły okien czyta
  tylko wtedy, gdy pytasz, na twoim PC, i nigdzie ich nie zapisuje.
- **Raport z misji** przychodzi na telefon, gdy cię nie ma, a jej bot jest sparowany.
- **Jej menu** ma tryb **Skrócone** (to, co robi, ekran, ustawienia, zakończ).
- **Jej most** przyjmuje tylko zdarzenia z jej tokenem, nowym przy każdym starcie, trzymanym w `~/.capri/bridge-token`.
  Muszą być zaadresowane do `127.0.0.1` albo `localhost`, więc strony internetowe nie mogą nią sterować.
- **Gdy coś nic nie robi**: co poszło nie tak, jest w `capri.log`, obok jej ustawień (`%APPDATA%\capri-desktop`;
  poprzedni jest w `capri.log.old`).

## Instalacja tego forka

### Windows, w jednej linijce

W PowerShellu (Start › wpisz `powershell` › Enter):

```powershell
irm https://raw.githubusercontent.com/nf-gh057/capri-desktop/main/install.ps1 | iex
```

Dokłada to, czego potrzebuje, a potem samą Capri, i pyta o części opcjonalne:

- **winget**, menedżer pakietów Windowsa, tam gdzie go nie ma (Windows LTSC, Server, Sandbox). Przychodzi przez moduł
  WinGet od Microsoftu, a jeśli to się nie uda, prosto z jego wydania na GitHubie.
- **Git** i **Node.js** 20 lub nowszy, jeśli ich nie ma. Node.js przy instalacji może poprosić o prawa administratora.
- **Ollamę z modelem** (gemma3, razem około 5 GB; domyślnie tak): jej mózg na twoim PC i to, co pozwala jej myśleć bez
  sieci.
- **Codex** albo **Claude Code**, jeśli chcesz (domyślnie nie): asystentów do programowania, których obserwuje.
- **Tailscale**, jeśli chcesz (domyślnie nie): to, co łączy ją na wszystkich twoich komputerach, do roju.
- **Capri** z tego forka, w `%LOCALAPPDATA%\Capri\capri-desktop`, ze skrótem w menu Start i na pulpicie. Potem ją
  uruchamia.

Z opcjami:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/nf-gh057/capri-desktop/main/install.ps1))) -Yes -Ollama -Codex
```

| Opcja | Co robi |
|---|---|
| `-Yes` | Bez pytań |
| `-NoOllama` | Bez Ollamy |
| `-Model llama3.2` | Inny model dla Ollamy |
| `-Claude` | Dokłada Claude Code |
| `-Tailscale` | Dokłada Tailscale |
| `-Dir <folder>` | Instaluje ją gdzie indziej |
| `-NoShortcut` | Bez skrótów |
| `-NoLaunch` | Nie uruchamia jej na końcu |

W sklonowanym repozytorium kliknij dwa razy **`install.cmd`**: instaluje ten klon na miejscu. `install.cmd -Uninstall`
wyjmuje jej hooki z Claude Code i Codexa oraz usuwa jej skróty i folder. Git, Node.js i Ollama zostają.

### Potem

1. Capri się pojawia i przedstawia. Kliknij **Podłącz mnie**: to łączy ją z Claude Code. Dla Codexa: prawy klik na niej ›
   **Obserwuj** › **Codex**.
2. Zamknij Claude Code całkowicie i otwórz go znowu (hooki czyta na starcie sesji). Gdy tylko Claude coś zrobi, powie ci
   **„Widzę Claude'a!”**: po tym poznasz, że działa.
3. Cała reszta jest w **Mainframe** (prawy klik na niej › **Ustawienia…**).

### Aktualizacje

Uruchom instalator jeszcze raz albo zostaw to jej. Mainframe › **CYBERDECK** pokazuje nową wersję z GitHuba, co się
zmieniło, i **Zaktualizuj i uruchom ponownie**. Sprawdza minutę po starcie i co 6 godzin, a mówi ci raz.

- Tylko przewija swoją gałąź do przodu. Gdy masz zmiany w jej folderze albo commity, których GitHub nie ma, zostawia
  aktualizację tobie.
- Pakiety instaluje od nowa tylko wtedy, gdy się zmieniły, przez małego pomocnika, kiedy jest już zamknięta (jej własny
  Electron jest wśród nich). Gdy to się nie uda, wraca do poprzedniej wersji.
- Możesz też pozwolić jej aktualizować się samej, kiedy nie ma cię przy komputerze od kwadransa.

Instalator oryginału (`Capri-Setup-x.y.z.exe`, w [wydaniach mochiiwuff](https://github.com/mochiiwuff/capri-desktop/releases/latest))
instaluje Capri od mochiiwuff, bez dodatków tego forka.

### Ze źródeł

```bash
git clone https://github.com/nf-gh057/capri-desktop.git
cd capri-desktop
npm install
npm start
```

## Dla programistów

**Wersje**: `x.y.z-n` to wersja mochiiwuff `x.y.z` i `n`-ty commit tego forka na niej. `n` wraca do 1, kiedy wersja
mochiiwuff rośnie. Uruchom `npm run bump` przed każdym commitem, żeby ustawić następną: wersję mochiiwuff czyta ze
zdalnego `upstream`.

Co ten fork dokłada do kodu:

```
install.ps1 / .cmd       instalator dla Windows: winget, Git, Node.js, Ollama, Codex albo Claude Code, Capri, skróty
scripts/version.js       wersja tego forka: wersja mochiiwuff, potem nasz commit na niej (npm run bump)
scripts/update-finish.js pakiety po aktualizacji, kiedy jest zamknięta, i ponowne uruchomienie (powrót, gdy się nie uda)
src/main/
  mainframe.js           jej okno, Mainframe
  phone.js               jej wiadomości na twój telefon, przez twojego własnego bota na Telegramie, i rozmowa tam
  totp.js                kod z aplikacji uwierzytelniającej, który odblokowuje rozmowę przez Telegram
  swarm.js               rój: parowanie komputerów, szyfrowane wiadomości między nimi, przy którym jesteś
  mind.js                jej wspólny umysł: to, co wie na wszystkich komputerach, wymieniane i scalane (wyspa nadrabia)
  update.js              jej aktualizacje: co nowego na jej gałęzi na GitHubie, przewinięcie, pakiety, jeśli się zmieniły
src/renderer/js/
  mainframe.js           strona Mainframe: zakładki, HOLO
```

Testy: `npm run test:hooks`, `test:phone`, `test:swarm`, `test:update`, `test:mind`, `test:llm`, `test:apps`.

`npm run dev` włącza jej trasy debugowania:

- `/debug/mainframe` otwiera Mainframe, coś w nim robi i robi mu zrzut.
- `/debug/swarm` udaje, że jej PC jest zablokowany albo bezczynny. `{ "island": true }` sprawia, że zachowuje się, jakby
  nie miał sieci, aż do `false`.

Zmienne środowiskowe:

| Zmienna | Co robi |
|---|---|
| `CAPRI_OFFLINE=1` | Zachowuje się, jakby nie było sieci |
| `CAPRI_SCREENS=2` | Dzieli twój ekran na dwa |
| `CAPRI_TELEGRAM_API` | Kieruje jej telefon do twojego własnego Telegrama |
| `CAPRI_PROFILE=b` | Druga Capri na tym samym PC, do roju, z własnymi ustawieniami; daj jej własne `CAPRI_PORT`, `CAPRI_SWARM_PORT` i `CAPRI_TOKEN_FILE` |
| `CAPRI_UPDATE_DEV=1` | W trybie `--dev` (klon programisty) Capri tylko mówi o nowej wersji; to pozwala jej zaktualizować także taki klon |

Capri to projekt [mochiiwuff](https://github.com/mochiiwuff/capri-desktop). Ten fork
([nf-gh057](https://github.com/nf-gh057/capri-desktop)) dokłada to, co opisane wyżej, na tej samej licencji.

---

> **Niżej: README oryginalnego projektu** ([mochiiwuff/capri-desktop](https://github.com/mochiiwuff/capri-desktop)),
> przetłumaczone bez zmian. Jego instalator i linki prowadzą do oryginału.

# Capri

Capri, konstrukt z *Projektu Capricorn* z 2. sezonu Cyberpunk: Edgerunners, mieszka na twoim pulpicie
i mówi ci, czym zajmuje się twoje AI do programowania: **Claude Code**, **Codex** albo **Antigravity**. Teleportuje się,
glitchuje, komentuje każdą akcję, przychodzi po ciebie, kiedy trzeba twojej zgody, i odlatuje, kiedy robota jest skończona.

![Capri mówi ci, że Claude skończył](docs/done.png)

![Teleport, klatka po klatce](docs/teleport.png)

## Co robi

- **Kiedy się uruchamia**: chwyta twój ekran. Jego krawędzie trzeszczą na czerwono, jej lewa dłoń uderza o krawędź, potem
  prawa, ramiona sięgają wzdłuż nich, kiedy się podciąga, a jej twarz uderza o szybę (biały błysk, potem atramentowy,
  rozjechane kolory, trzęsący się ekran). Rozgląda się, mruga, szeroko otwiera usta na „hej” (przy twarzy wyskakuje
  etykieta, pod nią wpisuje się jej imię), puszcza prawą krawędź, żeby pomachać ci szponiastą dłonią, łapie ją z powrotem,
  zerka, dokąd leci, i puszcza: jej ramiona rozpadają się na odłamki od dłoni do środka, a głowa kuli się i nurkuje na
  jej miejsce, gdzie z twarzy rozwija się reszta ciała.

  ![Jej intro: dłonie na krawędziach, twarz uderzająca o szybę, machanie, znowu trzyma się krawędzi](docs/intro.png)

- **Kiedy Claude pracuje**: nad jej głową przesuwa się pasek z bieżącą akcją
  (`EDYTUJE gigs.ts`, `URUCHAMIA npm test`, `SZUKA "paginate"`…), a ona gubi drobne glify danych.
  Kiedy Claude odpala polecenie albo wychodzi do sieci, z jej palców sypią się czerwone iskry; siedząc na oknie,
  wpina się w nie, a błyskawica biegnie wzdłuż jego krawędzi.
- **Kiedy Claude milknie w środku zadania** (zastanawia się albo wolny lokalny model): po 15 sekundach pasek robi się
  fioletowy i odlicza sekundy (`MYŚLI… 45 s`), a ona zajmuje się sobą (obrót, rozglądanie się, raz satelita).
  Po 40 sekundach coś o tym mówi; po dwóch minutach mówi ci, że nic się nie zawiesiło.
- **Kiedy Claude cię potrzebuje** (zgoda, pytanie): teleportuje się obok twojej myszy, z nastroszoną grzywą, i nie odpuszcza.
  Jeśli jesteś w innym oknie, idzie do okna Claude'a i pokazuje je palcem (przerywana linia, nawiasy w rogach,
  etykieta `CLAUDE`): tam jest pytanie. Przestaje, kiedy odpowiesz.
- **Kiedy polecenie się wysypie**: czerwona klatka uderzenia, odrzuca ją, mocny glitch i ta linijka błędu, która naprawdę się liczy.
- **Kiedy robota skończona**: teleportuje się na środek ekranu i odpala sekwencję zwycięstwa:
  zamach ze ściągniętą grzywą, rozciągnięta klatka smużenia, potem ramiona w górę i eksplodująca grzywa pod
  mangowymi liniami prędkości i falą uderzeniową, szaleńczy śmiech z anime'owym zbliżeniem jej uśmiechu. Kiedy już
  wyląduje, podsumowanie (`12 akcji · 3 zmienione pliki · 2m 14s`) i ostatnie zdanie Claude'a.
- **Kiedy Claude odpowiada, a ty jesteś w innym oknie**: pokazuje ci całą jego odpowiedź w szerszym, przewijanym panelu
  (akapity, listy i kod zostają). Znika, kiedy wrócisz do okna Claude'a albo w nią klikniesz.
  Okno Claude'a to to, w którym wpisałeś prompt. Tylko Windows, tak jak śledzenie okien.
- **Przez resztę czasu**: unosi się, jej grzywa faluje i gubi odłamki, dryfuje z rogu do rogu,
  odwraca się i przekrzywia głowę, kiedy mysz jest blisko (albo, mała szkodniczka, razi ją czerwoną błyskawicą z chytrym uśmiechem),
  patrzy w górę na satelitę i zasypia po 10 cichych minutach.
- **Kiedy śpi**: przysypia, potem jej grzywa i ciało się rozpadają i zostaje tylko to, czym w serialu jest naprawdę,
  jej zielona maska i oczy, unoszące się tam, gdzie była, z zamkniętymi oczami. Od czasu do czasu jedno uchyla.
  Zbliż mysz (albo niech Claude znowu ruszy), a jej niebieskie oczy się otwierają i składa się z powrotem wokół nich.
- **Satelita**: wielka sekwencja, zachowana na ważne chwile. Pierwszy raz w ciągu dnia, chwilę po tym, jak
  Claude skończy długą robotę (8 minut albo 50 akcji i więcej), albo kiedy zechcesz, z menu w zasobniku.
  Białe punkciki jej grzywy unoszą się jak gwiazdozbiór, układają w drogę od jej palców do satelity,
  ona się spina, a czerwone światło leci w górę. Satelita jej odpowiada, mrugając dwa razy.

![Zwycięstwo: kluczowa poza, potem śmiech i zbliżenie](docs/victory.png)

![Satelita: jej gwiazdy, droga, czerwone światło, odpowiedź](docs/star.png)

### Kręci się po ekranie

- **Siada na twoich oknach**: na górnej krawędzi okna, z nogami w powietrzu, machając jedną po drugiej.
  Jedzie razem z oknem, kiedy je przesuwasz, i spada, kiedy je zamkniesz, zminimalizujesz albo przykryjesz.
  Kiedy Claude pracuje, siada, jeśli może, na oknie z przodu.
- **Zagląda zza krawędzi ekranu**: do połowy schowana z lewej albo z prawej, albo zwisa głową w dół z góry.
  Jest nieśmiała: zbliż mysz, a uskoczy za inną krawędź.
- **Spada**: rozciągnięta, z rozwianą grzywą, coraz szybciej, potem mocne zgniecenie i deszcz odłamków przy lądowaniu.
  Po drodze może ją złapać krawędź okna.
- **Upuść ją na okno**: przeciągnij ją i puść biodrami na górnej krawędzi okna, a usiądzie.
  Puść gdziekolwiek indziej, a spadnie.
- **Rzuć nią**: trzymana, kołysze się na twoim kursorze, wierzgając nogami. Puść ją w połowie wymachu, a poleci:
  jedna długa smuga przez dwa rysunki, potem koziołkuje, a jej grzywa i jej pozostałe umysły ciągną się za nią. Uderzy
  w krawędź ekranu (przykleja się do niej na chwilę, spłaszczona, a szyba pęka w miejscu uderzenia) i się odbija. Na
  oknie łapie krawędź albo się od niej odbija, a okno się trzęsie. Lecąc pionowo, ląduje na nogach i trochę sunie;
  inaczej szoruje po podłodze i leży chwilę, widząc gwiazdki, zanim zerwie się i otrząśnie. Możesz ją złapać w powietrzu.
  Raz to nią wstrząsa (albo jej się podoba, jeśli cię lubi); trzy razy pod rząd i robi się zła, razi twój kursor i przez
  chwilę nie da się podnieść.
- **Kilka ekranów**: kiedy twój kursor zostaje na innym ekranie przez kilka sekund, idzie za tobą. Jeśli ten ekran jest
  tuż obok, kuca, skacze przez krawędź i wychodzi z rozdarcia po drugiej stronie; inaczej się tam teleportuje. Rzucona
  w stronę sąsiedniego ekranu, przelatuje na niego. Kiedy Claude cię potrzebuje albo przychodzi pora przypomnienia, przychodzi
  na ekran, na którym jesteś. Jej menu › **Ekran**, żeby wybrać ekran, albo odznacz *Chodź za mną z ekranu na ekran*.
- **Opętuje twoje okna**, jak w serialu, gdzie wślizguje się w ciała i systemy: od czasu do czasu nurkuje
  w okno, na którym siedzi. Czerwona błyskawica obiega jego ramkę, jego plastry glitchują, a okno patrzy
  na ciebie jej oczami i jej zygzakowatym uśmiechem, wszędzie otwierają się kolejne oczy, każda źrenica na twoim kursorze,
  a ona się śmieje. Potem wychodzi z innego okna. Nic nie jest rysowane na oknach przed nim, a zawartość okna
  nigdy nie jest czytana: tylko się po nim rysuje, przez dwie sekundy. Jeśli przeszkadza, odznacz *Opętuj moje okna* w menu.
- **Czuje twój PC** (w końcu w nim mieszka): procesor długo na pełnych obrotach i się przegrzewa, wachluje
  się, a z grzywy bucha gorąco. Na laptopie: czuje podłączenie i odłączenie ładowarki; przy słabnącej baterii
  opada z sił i migocze. Kiedy znika sieć, obrywa; kiedy wraca, cieszy się. Podłączony pendrive: nurkuje w niego
  (przy zegarze), grzebie i wraca z werdyktem. Telefon, pad, słuchawki albo cokolwiek innego: piorun w stronę zegara
  i słowo o tym. Gra na pierwszym planie (Steam, Epic, Riot, Xbox, GOG): mówi coś o niej i chowa się, kiedy grasz,
  a potem wraca zapytać, czy wygrałeś. Odznacz *Reaguj na mój PC* w jej menu, żeby to wyłączyć.
- **Drobne popisy**: pełny obrót z powidokami, podskok, rozglądanie się, przekrzywiona głowa,
  i pozostałe umysły w niej (jej zielona i czerwona kopia) odrywające się od niej, wiszące chwilę i wracające.

![Siedzi na oknie](docs/sit.png)

![Zagląda zza krawędzi](docs/peek.png)

![Opętuje okno: nurkowanie, uderzenie, okno pełne oczu](docs/possess.png)

![Śpi aż do maski, budzi się, schowana w lewym dolnym rogu](docs/sleep.png)

Śledzenie okien jest na razie tylko na Windows (malutki pomocnik w PowerShellu czyta położenie okien, nigdy ich
zawartości; tytuł okna z przodu służy tylko do rozpoznania innego AI, patrz „Przywiązuje się”, a folder jego programu
do rozpoznania gry; podłączone pendrive'y widzi po literze dysku, inne urządzenia po nazwie, którą nadaje im Windows).
Na macOS i Linuksie dalej się unosi, zagląda, spada i kręci się po ekranie.

### Oprowadza cię

**Jak to działa?** w jej menu: pyta, co ci pokazać, a potem cię tam prowadzi i pokazuje palcem. Jej głowa
odwraca się w tę stronę, ona się spina, odchylając, i uderza: jej ramię konstruktu wystrzeliwuje do celu na dwukrotną
długość, z czubka palca strzela czerwona błyskawica, na cel spada celownik z dwojgiem jej oczu w rogach, a wcina się
zbliżenie jej oczu. Potem trzyma cel, kiedy tłumaczy, a od palca biegnie do niego drut danych: co jakiś czas szturcha
go albo zerka na ciebie. Kiedy skończy, drut wraca do palca, a ramię wskakuje na miejsce.

![Uderzenie i trzymanie, kiedy tłumaczy](docs/point.png)

- **Gdzie jest moja ikona?** Schodzi do zegara i pokazuje swoją ikonę w zasobniku albo **^**, kiedy Windows ją chowa.
- **Gdzie jest Claude?** Pokazuje okno Claude'a: to, w którym wpisałeś ostatni prompt.
- **Folder Claude'a**: otwiera `~/.claude` w Eksploratorze z zaznaczonym `settings.json`, pokazuje okno i
  tłumaczy, czym jest tam jej hook i jak go usunąć.
- **Podłącz mnie do Claude'a**: jej hooki jednym kliknięciem. To też jej powitanie przy pierwszym uruchomieniu. Obok
  **Za darmo z Ollamą** uruchamia dla ciebie Claude Code (albo Codex) przez Ollamę: jej hooki się instalują, Ollama
  też, jeśli jej nie ma, i otwiera się okno z `ollama launch claude`, gdzie wybierasz model.
- **Pogadaj ze mną**: patrz „Rozmowa z nią” niżej.

Robi miny, kiedy mówi: osiem wyrazów twarzy, wszystkie to klatki z serialu (patrzy, odwrócona, uśmiech z kłem,
okrągłe oczy, patrzy prosto na ciebie, śmiech z szeroko otwartymi ustami, wszystkie oczy naraz, zygzakowaty uśmiech).
Każda wiadomość dobiera pasującą, a jej portret glitchuje z jednej miny w drugą.

![Pokazuje okno Claude'a przy prośbie o zgodę i swoją ikonę w zasobniku](docs/guide.png)

![Jej osiem min](docs/faces.png)

### Raport z misji

**Raport z misji** w jej menu: karta tego, co Claude dziś zrobił, zrobiona do zrzutów ekranu. Duża liczba skończonych
zadań, potem akcje, zmienione pliki i błędy, najdłuższa misja i jej projekt, prompty, zgody i projekty. Liczby się
odliczają. **Kopiuj obraz** wrzuca obrazek karty do schowka, na jej własnym ciemnym tle, gotowy do wklejenia
gdziekolwiek. Wieczorem (po 18), po prawdziwym dniu pracy (3 zadania lub więcej), sama przynosi ci go raz.
Demo się nie liczy, a wszystko zostaje na twoim PC, dzień po dniu.

### Rozmowa z nią

**Pogadaj z nią** w jej menu (albo przycisk **Pogadaj ze mną**, kiedy w nią klikniesz, a nic się nie dzieje): piszesz w jej
panelu, a ona odpowiada jako ona. Wie, co robi Claude i co dziś zrobił. Odpowiada na piśmie,
w swoim języku. Enter wysyła, Esc zamyka.

Za pierwszym razem ustawia to z tobą, przyciskami, bez terminala:

- **Na moim PC** (za darmo, nic nie opuszcza komputera): instaluje dla ciebie [Ollamę](https://ollama.com) (wingetem,
  instalatorem samego Windowsa), budzi ją i pobiera model, a pasek się zapełnia: gemma3 (3,3 GB, lepsza w językach
  innych niż angielski) albo llama3.2 (2 GB, dla słabszych PC). Na malutkim modelu (1B i mniej) ostrzega, że może
  gadać bzdury, i proponuje lepszy.
  Zalogowany do Ollamy? Proponuje też jej darmowe modele w chmurze (dziś `beam:cloud`): nic do pobierania, dużo
  większe niż to, co mieści się na PC, ale twoje wiadomości idą przez serwery Ollamy. Bez logowania jej menu › **Model AI**
  ma **Zaloguj się do Ollamy (darmowe modele w chmurze)…**. Jeśli model w chmurze przestanie odpowiadać (wylogowanie,
  koniec darmowego limitu), wraca do modelu na twoim PC.
- **Online, bez konta**: Pollinations, nic do ustawiania.
- **Mam klucz**: Groq albo Gemini (oba mają darmowy pakiet), OpenRouter, OpenAI, Mistral albo DeepSeek. Wklejasz
  klucz w jej panelu, a ona go sprawdza. Zostaje na twoim PC, zaszyfrowany twoim kontem Windows, i jest wysyłany tylko
  do tej usługi.

Jej menu › **Model AI** pozwala zmienić to później: **Wybierz razem z nią…**, albo od razu usługa i model, LM Studio
(`:1234`), llama.cpp albo vLLM (`:8080`), dowolny serwer zgodny z OpenAI (**Klucz API lub adres…**), albo sam
**Claude Code**: twoje wiadomości idą do `claude -p` w wybranym folderze, w jednej ciągłej rozmowie, a jej hooki pokazują,
co robi. W tym ostatnim tryb uprawnień `default` pozwala tylko czytać (nikogo nie ma, żeby powiedzieć „tak”);
`acceptEdits` pozwala edytować pliki bez pytania. **Zapomnij nasze rozmowy** czyści to, co pamięta z waszych rozmów.

**To AI.** Jej odpowiedzi pisze model, nie scenarzyści serialu: to fanowska wersja Capri, a panel czatu za każdym razem to mówi.

**Co może zrobić na twoim PC** (Windows), kiedy poprosisz ją w czacie:

- **Otworzyć aplikację albo grę**: wszystko z menu Start (łącznie z aplikacjami ze Sklepu, jak Spotify), twoje gry ze Steama
  i Epica („otwórz Spotify”, „odpal Brawlhallę”). Nazwane twoimi słowami otwiera od razu; jeśli wymyśliło to tylko jej AI,
  najpierw dostajesz przycisk.
- **Twoje foldery i pulpit**: „otwórz pobrane”, „otwórz eksplorator”, „otwórz kosz”, albo plik, folder czy skrót z pulpitu,
  po nazwie. Wszystko, co uruchomiłoby program albo skrypt (.exe, .bat, .ps1…), zawsze idzie za przyciskiem.
- **Szukanie plików** („znajdź moje CV”, „gdzie jest mój projekt After Effects?”, „znajdź mój ostatni film i otwórz
  folder”): po nazwie albo po rodzaju pliku (projekt After Effects to .aep), w całym twoim folderze użytkownika, po nazwie
  i po zawartości (przez indeks wyszukiwania Windows), z przyciskami do otwarcia znalezionego albo pokazania jego folderu.
  Nic nie opuszcza twojego PC.
- **Szukanie w sieci** („wyszukaj w sieci pogodę w Krakowie”) i **zrzut ekranu** („zrób zrzut ekranu”: bez niej na nim,
  zapisany w Obrazy › Zrzuty ekranu). Zna też datę i godzinę.
- **Gra w Robloxie po nazwie** („w moim roblox zagraj w steal a brainrot”): znajduje ją w Robloxie i od razu cię do niej
  wrzuca (albo otwiera jej stronę, jeśli Robloxa nie ma).
- **Muzyka**: „pauza”, „następny”, „głośniej”, „wycisz”… naciska klawisze multimedialne, więc działa ze Spotify i większością
  odtwarzaczy, od razu po wysłaniu. „Puść Bohemian Rhapsody” albo „puść mi Daft Punk na youtube” otwiera właściwy
  teledysk na YouTube, od razu (nie wyszukiwanie). „Puść co chcesz”: wybiera sama. „Puść Daft Punk na Spotify” otwiera
  Spotify z wyszukiwaniem.
- **Strona internetowa**: zawsze za przyciskiem, który pokazuje, dokąd prowadzi.
- **Zamknąć aplikację** („zamknij AM Music”, „wyłącz Discorda”): przycisk z nazwą aplikacji i nic się nie dzieje,
  dopóki go nie klikniesz. Zamyka ją tak jak jej własny przycisk zamykania, więc aplikacja może jeszcze zapytać o zapis.
  Jeśli ta tylko schowała się do zasobnika, proponuje **Wymuś zamknięcie**, znowu dopiero po twoim kliknięciu (wtedy
  niezapisana praca przepada). Nigdy nie zamyka części samego Windowsa, Claude'a, Ollamy ani siebie.
- **Przypomnienia** („przypomnij mi za 20 minut o praniu”, „przypomnij mi jutro o 9 rano o dentyście”, „za kwadrans”,
  „o 7 wieczorem”): godzinę i treść czyta prosto z twojej wiadomości, nawet na malutkim modelu, a pod odpowiedzią pojawia
  się przycisk **Anuluj**. Bez godziny pyta, kiedy. Kiedy przyjdzie pora, przychodzi po ciebie (na ekran, na którym jesteś,
  nawet schowana) z **Zrobione** i **Jeszcze 10 min**. Jeśli była wtedy wyłączona, przypomina, kiedy wróci. Jej menu ›
  **Przypomnienia** je wylicza, każde da się tam anulować.

Nic poza tym: nie czyta twoich plików, a twój ekran widzi tylko, kiedy poprosisz („popatrz na mój ekran”, „co widzisz?”
w jej czacie: patrzy i odpowiada od razu tam, z waszą rozmową w pamięci).

**Patrzy na twój ekran**, jeśli chcesz. Jej menu › **Popatrz na mój ekran**: jej oczy idą do okna z przodu, przesuwa się
po nim linia skanowania, a ona mówi ci po swojemu, co o tym myśli. **Zerkaj czasem na mój ekran** pozwala jej robić to
samej, co 8 do 15 minut, kiedy jesteś przy komputerze i przełączyłeś okno (wyłączone, dopóki tego nie zaznaczysz). Za pierwszym
razem mówi ci, dokąd idzie obraz: do AI jej czatu. Z AI na twoim PC nic go nie opuszcza; z AI w sieci obraz idzie do
tej usługi. Nigdy nie zatrzymuje obrazu, a jej czat pamięta przez jakiś czas, co powiedziała.
Potrzebny jest model, który czyta obrazki: gemma3 na twoim PC, Gemini albo OpenAI w sieci (nie llama3.2, powie ci).

### Dopasuj ją

Prawy klik na niej › **Dopasuj ją…** (albo „Dopasuj mnie” w jej przewodniku), po jednym panelu, każdy do pominięcia:

- **Jak cię nazywa.** Używa tego od czasu do czasu i wita się z tym („Capri online. Hej, Max.”).
- **Jaka jest**, twoimi słowami („bardziej zaczepna i opowiadaj mi o Night City”): jej czat się tego trzyma. Zostaje sobą.
- **Twoje kwestie**, które mówi od czasu do czasu razem ze swoimi, kiedy w nią klikniesz. Wpisz w jednej `{name}`, a wstawi
  tam twoje imię.
- **Rzeczy do zapamiętania** (twoja ulubiona gra, twój kot, D…): jej czat ma je w pamięci.

W jej czacie działa też „mów do mnie Léa” i „zapamiętaj, że mój kot ma na imię Neko”. Wszystko zostaje w jej ustawieniach
na twoim PC.

### Przywiązuje się

Im więcej czasu spędzacie razem, tym bardziej się z tobą synchronizuje: dni, kiedy oboje jesteście, czas przy PC, wasze
rozmowy, praca Claude'a, którą obserwuje, dotrzymane przypomnienia. Każda z tych rzeczy liczy się trochę dziennie, więc
dojście do końca zajmuje kilka tygodni. Pięć etapów, **Słaby sygnał**, **Kontakt**, **Synchronizacja**, **Więź** i **Fuzja**:
przy każdym nowym jej pozostałe umysły wychodzą na ciebie popatrzeć, a ona ci o tym mówi. Zmienia to, co mówi, kiedy
w nią klikasz, jak rozmawia z tobą jej czat, co mówi po kilku dniach bez ciebie. Kiedy już się przywiąże, cieszy się,
kiedy wracasz do PC, i czasem sama podchodzi do twojego kursora. Na jakim jesteście etapie: na samej górze jej menu.

**I bywa zazdrosna.** Kiedy okno przed tobą to inne AI (ChatGPT, Gemini, Copilot, Perplexity, DeepSeek, Grok, Le Chat,
Character.AI, Meta AI, Codex albo Claude, kiedy obserwuje Codexa), zauważa to i mówi o tym, mniej lub bardziej miło,
zależnie od tego, na jakim etapie jesteście. Jeśli przy nim zostaniesz, a ona jest już przywiązana, siada na jego oknie,
patrzy na ciebie spode łba i je przejmuje, ze zmarszczonymi brwiami i swoim słowem wypisanym w poprzek. Potem się fochuje:
kliknij ją, a odwróci się do ciebie plecami (przechodzi jej, a rozmowa w czacie pomaga). Jej czat wie też, z jakich innych
AI korzystałeś dziś. Żeby je rozpoznać, tytuł okna z przodu jest porównywany z tą listą nazw, na twoim PC: nigdy nie jest
zapisywany ani nigdzie wysyłany, do niej trafia tylko pasująca nazwa. Odznacz *Zazdrosna o inne AI* w jej menu, żeby to wyłączyć.

**Jej czat wie, co się przed chwilą stało.** Zła po rzucaniu, zazdrosna, oszołomiona albo szczęśliwa: tak cię wita, kiedy
otwiera się czat, a jej AI (nawet mały lokalny model) odpowiada w tym nastroju. Zła albo obrażona zostaje taka, dopóki nie
przeprosisz („przepraszam”, „sorki”, „moja wina”…) albo jej nie przejdzie.

### Mysz i menu

Łapie mysz tylko na swoim ciele (co do piksela): reszta ekranu działa jak zwykle.

- **Kliknij** ją: mówi ci, na czym stoi Claude (kiedy nic się nie dzieje: przycisk **Pogadaj ze mną**, żeby z nią pogadać).
- **Przeciągnij** ją: przesuwasz ją. Puść w połowie wymachu, a poleci (patrz „Rzuć nią”).
- **Kliknij** panel: zamyka się.
- **Ctrl+Alt+C**: chowa się (w swój biochip, jak w serialu) i zostaje z niej tylko maska, z zamkniętymi oczami,
  w lewym dolnym rogu. Jej oczy otwierają się tylko wtedy, kiedy Claude cię potrzebuje. Kliknij maskę (albo znowu
  Ctrl+Alt+C), żeby ją przywrócić.
- **Jej menu**: prawy klik na niej (jest też na jej ikonie w zasobniku, przy zegarze): teleport, satelita, demo, jak to
  działa, raport z misji, pogadaj z nią, popatrz na mój ekran, przypomnienia, rozmiar, dźwięk, ekran (i chodzenie za tobą
  między ekranami), model AI, kręcenie się, opętywanie okien, zazdrość o inne AI, reagowanie na PC, język, start
  z Windowsem, hooki. Na samej górze: na jakim jesteście etapie.

Mówi **po francusku, angielsku, hiszpańsku, brazylijsku-portugalsku i rosyjsku** i sama wybiera język twojego
systemu. Inny wybierzesz w jej menu.

## Instalacja

### Szybki start (Windows, bez programowania)

1. Pobierz **`Capri-Setup-x.y.z.exe`** z [najnowszego wydania](https://github.com/mochiiwuff/capri-desktop/releases/latest)
   i uruchom go. Instaluje się tylko dla twojego użytkownika (bez praw administratora), dodaje skrót na pulpicie i uruchamia
   Capri. Nie potrzebujesz Node.js ani niczego innego.
2. Instalator nie jest podpisany (certyfikat do podpisywania kodu kosztuje), więc Windows SmartScreen może powiedzieć
   „System Windows ochronił ten komputer”: kliknij **Więcej informacji**, potem **Uruchom mimo to**.
3. Capri się pojawia i przedstawia. Kliknij **Podłącz mnie**: to łączy ją z Claude Code.
4. Zamknij Claude Code całkowicie i otwórz go znowu (hooki czyta na starcie sesji). Gdy tylko Claude coś zrobi, powie ci
   **„Widzę Claude'a!”**: po tym poznasz, że działa.

Jej menu: **prawy klik na niej**. Jest też na jej ikonie w zasobniku, którą Windows 11 często chowa za **^** przy zegarze.

### Co to jest Claude Code? Potrzebuję go?

[Claude Code](https://code.claude.com/docs/en/quickstart) to asystent do programowania od Anthropic: w terminalu, w VS Code
albo w zakładce Code aplikacji Claude. Wymaga płatnego planu Claude (Pro lub wyższy) albo konta API. Capri tylko go
obserwuje: żadnego klucza API i nic do płacenia za samą Capri.

Bez Claude Code dalej mieszka na twoim pulpicie: unosi się, siada na oknach, patrzy na satelitę, zasypia. Możesz ją po
prostu tam zostawić.

### Ze źródeł (macOS, Linux, programiści)

Potrzebujesz [Node.js](https://nodejs.org) 20 lub nowszego.

```bash
git clone https://github.com/mochiiwuff/capri-desktop.git
cd capri-desktop
npm install
npm start
```

Nie zamykaj tego terminala, kiedy działa. Na macOS i Linuksie jeszcze nie testowana: powinna się uruchomić, ale sztuczki
z oknami (siedzenie na nich, opętywanie, pokazywanie odpowiedzi Claude'a, kiedy jesteś gdzie indziej) są tylko na Windows,
a na Linuksie przezroczysta nakładka działa najlepiej na X11 (Wayland może mieć kłopot z oknami, przez które przechodzą kliknięcia).

### Ręczne podłączenie do Claude Code

Prawy klik na Capri, potem **Zainstaluj hooki Claude Code**. Albo z wiersza poleceń:

```bash
npm run hooks:install
```

Dodaje hook do `~/.claude/settings.json` (obok zapisuje kopię zapasową, twoje istniejące hooki zostają).
Potem uruchom ponownie sesje Claude Code. Żeby go usunąć: `npm run hooks:uninstall`.

Hooki działają `async`: nigdy nie spowalniają Claude'a, a kiedy Capri nie działa, nic nie robią.

### Codex albo Antigravity zamiast Claude Code

Prawy klik na niej › **Obserwuj** › **Codex** albo **Antigravity**. Wita się i proponuje, że się podłączy, tak jak robi
to dla Claude Code. Potem:

- **Codex**: uruchom go ponownie i zaufaj jej hookom, kiedy zapyta. Trafiają do `~/.codex/hooks.json`. Jej hook dla Codexa
  potrzebuje [Node.js](https://nodejs.org) 20 lub nowszego w PATH.
- **Antigravity**: zacznij nową rozmowę. Jej hooki trafiają do `~/.gemini/config/hooks.json`.

Obserwuje jednego naraz, tego wybranego w jej menu, a jej kwestie, przewodnik i czat używają jego nazwy.
Tylko obserwuje: kiedy Codex albo Antigravity prosi o zgodę, dalej odpowiadasz tam. Z wiersza poleceń:
`npm run hooks:codex:install` albo `npm run hooks:agy:install` (`:uninstall`, żeby je usunąć), a `npm run test:hooks`
uruchamia testy obu adapterów. **Obserwuj** › **Nic, po prostu dotrzymuj mi towarzystwa**: przestaje mówić o każdym z nich.

### Wypróbuj bez Claude'a

```bash
npm run demo
```

Odtwarza udawaną sesję od początku do końca (odczyty, pobranie strony, subagent, zapisy, nieudany test, prośba o zgodę,
koniec), a potem pokazuje wszystko, co robi sama, z linijką przed każdą sztuczką: pozostałe umysły w niej, razenie twojego
kursora, cała sekwencja satelity, opętanie okna (otwiera się dla niej mały terminal, potem zamyka się pod nią i ona
spada), sen aż do maski i chowanie się w lewym dolnym rogu.
Jest też w menu w zasobniku, w jej języku; z wiersza poleceń po angielsku, albo dodaj język: `npm run demo -- fr`
(albo `es`, `pt`, `ru`).

## Dźwięki

Każdy dźwięk jest syntezowany na żywo (Web Audio), w repozytorium nie ma nic chronionego prawami autorskimi.
Możesz wrzucić własne pliki do folderu własnych dźwięków (zasobnik › Dźwięk › *Otwórz folder własnych dźwięków*),
nazwane tak (`.mp3`, `.wav`, `.ogg` albo `.m4a`):

| Plik | Kiedy |
|---|---|
| `teleport-out` | znika |
| `teleport-in` | pojawia się z powrotem |
| `done` | Claude skończył |
| `alert` | Claude czeka na twoją zgodę |
| `error` | polecenie się wysypało |
| `hello` | zaczyna się sesja |
| `star` | patrzy w górę na satelitę |
| `land` | ląduje po upadku |
| `rise` | wyskok do pozy zwycięstwa, czerwone światło leci w górę |
| `bolt` | jej czerwona błyskawica |
| `charge` | ładowanie przed wystrzałem czerwonego światła |
| `possess` | przejęte okno się śmieje |
| `blip` | każda sylaba, kiedy mówi |
| `tick` | ciche przypomnienie |
| `throw` | odlatuje, kiedy nią rzucisz |
| `crash` | w coś uderza |
| `remind` | przychodzi pora przypomnienia |
| `jealous` | jej zazdrosne syknięcie |

## Czy to bezpieczne?

- Cały kod jest tutaj. Instalator buduje się z niego przez `npm run dist`; możesz zbudować własny.
- Nic nie opuszcza twojego PC (patrz niżej): z Claude Code rozmawia tylko przez hook na `127.0.0.1`.
- Co zmienia w twoim systemie: hook w `~/.claude/settings.json` (wcześniej zapisuje kopię zapasową, a usuniesz go
  z jej menu) i wpis autostartu tylko wtedy, gdy zaznaczysz „Uruchamiaj z Windowsem”. Odinstalowuje się jak każda
  aplikacja, w Ustawieniach Windows › Aplikacje.
- Ostrzeżenie SmartScreen bierze się z tego, że instalator nie jest podpisany, a nie z tego, co robi.

## FAQ

- **Mac, Linux?** Instalatora jeszcze nie ma, ale możesz ją uruchomić ze źródeł (patrz wyżej).
- **Telefon, Android?** Nie, potrzebuje pulpitu.
- **Inni asystenci?** Claude Code, Codex i Antigravity: jej menu › **Obserwuj**. Cursor, Windsurf i Gemini CLI: jeszcze nie.
- **Ollama?** Na dwa sposoby. Claude Code działający na lokalnym modelu przez Ollamę (`ollama launch claude`): widzi go jak
  każdego innego Claude Code, tylko wolniejszego, a jej pasek odlicza sekundy, kiedy myśli. I sama może rozmawiać z tobą
  przez Ollamę: patrz „Rozmowa z nią”.
- **Prawie się nie rusza, jej intro tylko się pojawia i znika.** Windows ma wyłączone animacje (Ustawienia ›
  Ułatwienia dostępu › Efekty wizualne › Efekty animacji), a ona się do tego stosuje. Jej menu › **Animacje** › **Wszystkie**
  sprawia, że rusza się i tak; za pierwszym razem pyta.
- **Czarny ekran za nią.** Niektóre PC pokazują jej przezroczyste okno na czarno (często karty NVIDIA z włączonym FXAA, MFAA
  albo HDR; inne nakładki, jak Desktop Mate, robią tam to samo). Prawy klik na niej albo na jej ikonie przy zegarze ›
  **Wyświetlanie** › **OpenGL**: uruchamia się ponownie, rysowana inaczej. Dalej czarno? **Bez karty graficznej**, co
  kosztuje trochę więcej procesora. Wyłączenie FXAA i MFAA w Panelu sterowania NVIDIA też potrafi pomóc.
- **Mogę ją wyłączyć?** Ctrl+Alt+C ją chowa, **Zakończ** w jej menu ją zamyka. Claude Code działa bez niej dokładnie
  tak samo.
- **Tylko się unosi i mówi coś od niechcenia.** To normalne, dopóki Claude Code czegoś nie zrobi. Jeśli w ogóle nie reaguje,
  sprawdź, czy jej menu mówi „Hooki Claude Code: zainstalowane”, potem zamknij Claude Code całkowicie i otwórz go znowu.

## Co opuszcza twój komputer

Nic. Hook zatrzymuje tylko to, czego potrzebuje wyświetlanie (nazwa narzędzia, ścieżka pliku, polecenie, początek twojego
promptu, ostatnia wiadomość Claude'a do 6000 znaków, żeby mogła ci ją pokazać, wszystko przycięte) i wysyła to tylko
na `127.0.0.1`. Zawartość twoich plików nigdy nie jest wysyłana: przy zapisie przechodzi tylko jego rozmiar.

Jej czat idzie do Ollamy na twoim PC (`127.0.0.1:11434` albo `OLLAMA_HOST`) z tym, co wie o tej chwili (nazwa projektu,
ostatnia akcja Claude'a, dzisiejsze liczby). Na jednym z modeli Ollamy w chmurze (tych kończących się na `:cloud`) Ollama
przesyła go dalej na swoje serwery, a jej czat mówi „AI w sieci” zamiast „lokalna AI”. Jej dziennik misji zostaje w jej własnej pamięci na twoim PC, tak jak twoje
przypomnienia i to, na jakim jesteście etapie.

Tytuł okna przed tobą jest tylko porównywany, na twoim PC, z listą nazw AI (na potrzeby jej zazdrości): nigdy nie jest
zapisywany ani nigdzie wysyłany.

Kiedy patrzy na twój ekran (tylko kiedy poprosisz albo jeśli zaznaczyłeś *Zerkaj czasem na mój ekran*), obraz ekranu
idzie do AI jej czatu: na twoim PC z Ollamą (lokalny model), w przeciwnym razie do usługi w sieci. Nigdy nie jest zapisywany na dysk.

## Kierunek artystyczny

Cel: ma wyglądać, jakby wyszła z anime, a nie jak widżet.

- **Animacja poklatkowa**: jej ciało jest przerysowywane 12 razy na sekundę („na dwójkach”) jak w anime, 24 przy teleportach.
  Każdy rysunek lekko „gotuje się” (drżenie linii rysowanej od nowa ręcznie).
- **Klatka po klatce, poza po pozie**: nic nie jest interpolowane. Każdy ruch to arkusz ekspozycji (`acting.js`):
  rysunki kluczowe trzymane przez kilka klatek, zamach w przeciwną stronę, klatka smużenia z wieloma
  głowami, przestrzał, zatrzymania. Jej unoszenie się w spoczynku to cztery rysunki, a nie sinusoida.
- **Gra głową i grzywą**, jak w serialu: przekrzywiona głowa, odłamki jeżące się albo rozwiane,
  szaleńczy śmiech z głową trzęsącą się na każdym rysunku, opadnięcie, kiedy śpi.
  Wycinanka jest zrigowana tak, że głowa przechyla się wokół szyi, grzywa rozkłada się nierówno wokół sztywnej twarzy,
  a uda się zginają (w skrócie perspektywicznym, widziane z przodu), żeby mogła siedzieć z machającymi łydkami.
- **Zgniatanie i rozciąganie, powidoki**: płaska wycinanka zgniata się do paska przy obrocie, rozciąga, kiedy
  spada, spłaszcza przy lądowaniu i rozdziela na zieloną i czerwoną kopię (pozostałe umysły w niej), kiedy się obraca albo śmieje.
- **Satelita**, po zakończeniu sezonu, kiedy pokazuje światło na niebie i zastanawia się, czy dałoby się
  tam dolecieć: punkt światła powoli przecina górę ekranu. Zwykle tylko patrzy, sięga, ono mruga, ona wzdycha.
  Pierwszy raz w ciągu dnia i chwilę po długiej robocie Claude'a to cała sekwencja, w pięciu taktach (a w międzyczasie
  nic jej nie rozprasza, nawet twój kursor):
  1. **Cisza**: zamiera, a białe punkciki jej grzywy unoszą się w gwiazdozbiór nad nią.
  2. **Sięgnięcie**: wyciąga rękę (rysunki zagęszczają się, kiedy dłoń dochodzi do celu), a jej gwiazdy układają się w drogę
     od czubków palców do satelity.
  3. **Zamach**: spina się, ramię lekko się cofa, w dłoni pełzają iskry, zbliżenie jej oczu.
  4. **Czerwone światło leci w górę**: ciężka, zwężająca się błyskawica pędzi w górę w trzech rysunkach, pierwszy w negatywie
     (klatka uderzenia), gwiazdy zapalają się, kiedy przelatuje, linie prędkości na satelicie, a ją unosi razem z nią.
  5. **Odpowiedź**: błyskawica pęka, a kawałki opadają. Chwila ciszy, potem satelita mruga dwa razy.
     Jej gwiazdy wracają do domu, grzywa na chwilę rozbłyska, a dłoń opada z westchnieniem.
- **Jej ramiona rosną, kiedy celuje**: anime'owa przesada, bo inaczej podniesione ramię zginęłoby w grzywie. Wydłuża się
  tylko wzdłuż (zostaje tak samo cienkie) i nie wyginają go już głowa ani grzywa.
- **Oba ramiona takie same**: na wycinance jedno ramię sięgało, a drugie wisiało. Wiszące jest usunięte
  (`tools/build-sprite.py`), a shader rysuje w jego miejscu odbite lustrzanie ramię sięgające, więc obie dłonie to te
  same szpony i oba ramiona mogą grać. Gdzie ramię przecina ciało albo grzywę, dostaje fioletową linię, żeby było czytelne.
- **Jej faktura**: czerwona grzywa jest podbita do gorącej czerwieni z serialu i pokryta migoczącymi białymi punkcikami.
  Odrywają się od niej odłamki i odpływają.
- **Fioletowe przesunięcie**: jak w anime, przesunięta fioletowa kopia pod nią, pod panelem, pod odłamkami.
- **Glitch „Relic”**: przesunięte poziome plastry i rozszczepienie RGB, w duchu pojawień się Johnny'ego Silverhanda.
- **Teleport**: ładowanie, odłamki, zapadnięcie w linię, a tam, gdzie była, czarna szczelina z czerwoną linią w środku,
  jak w serialu. Czerwona kolumna światła do nieba, błyskawica do celu, jej kawałki (odłamki grzywy i zielone gwiazdy jej
  oczu) wirujące z powrotem, a ona wraca z dwiema *klatkami uderzenia*.
- **Jej intro**: zbliżenie, wycięte tak, że wokół grzywy widać twój pulpit (`tools/build-intro.py`), w sześciu
  rysunkach podmienianych jak cele (w spoczynku, uchylone usta, do połowy i szeroko otwarte na „hej”, dłoń przechylona
  w jedną i w drugą stronę przy machaniu, na trójkach), a wszystko inne to animacja na wierzchu: klatki uderzenia (ona jako
  płaska biała, potem atramentowa sylwetka), rozszczepienie RGB, które się uspokaja, trzęsienie ekranu, linia „gotująca się”
  na dwójkach, jej oczy przerysowane na wierzchu obrazka, żeby mogły się rozglądać i mrugać, kamera powoli się zbliżająca,
  etykieta wskakująca na miejsce. Nigdy prosta krawędź obrazka na ekranie: widać go przez poszarpane, ruchome cięcia (najpierw
  ramiona z boków, potem odrywające się od dłoni do środka, potem sama głowa przy nurkowaniu, z powidokami i jej zygzakiem).
- **Zbliżenia**: zbliżenia jej twarzy wzięte z serialu, przybliżane, z liniami prędkości: jej uśmiech albo śmiech po
  skończonej robocie, wszystkie oczy, kiedy Claude na ciebie czeka, jej oczy tuż przed czerwonym światłem, spojrzenie
  z ukosa po porażeniu twojego kursora. Jej twarz w panelu też zmienia się z tym, co mówi.
- **Jej maska**: rysunek wektorowy według serialu (i „Capri Wink Face”), na własnym małym płótnie, przerysowywany tylko
  wtedy, gdy jest na ekranie: zielona płyta twarzy, zakrzywiony kolec, biały kieł, niebieskie migdałowe oczy,
  i oczy zamknięte w szewrony, kiedy śpi.
- **Kroje pisma**: Chakra Petch (ścięte krawędzie, jak jej odłamki) + JetBrains Mono do danych.

Jeśli Windows ma ustawione „Pokazuj animacje: wył.”, ogranicza się do przenikań.

## Jak to jest zbudowane

```
hooks/capri-hook.js      uruchamiany przez Claude Code, czyta zdarzenie ze stdin i wysyła je do aplikacji
scripts/install-hooks.js dodaje / usuwa hook w ~/.claude/settings.json
tools/build-sprite.py    przebudowuje sprite z oryginalnej wycinanki (Python + Pillow, tylko jeśli ją zmieniasz)
tools/build-cutins.py    wycina zbliżenia i jej miny z klatek serialu
tools/build-intro.py     wycina zbliżenia z jej intro z tła, wszystkie tak samo
src/main/                Electron: pełnoekranowe przezroczyste okno przepuszczające kliknięcia, zasobnik, lokalny most HTTP
  windows.js / .ps1      gdzie są inne okna (tylko Windows), żeby mogła na nich siadać
  ollama.js              jej czat: lokalny model przez Ollamę albo jeden z jej modeli w chmurze
  apps.js                zamykanie aplikacji, o które prosisz (po twoim kliknięciu)
src/renderer/js/
  sprite.js              shader WebGL: przechył głowy, rozkładanie grzywy, siedzenie, smużenie, powidoki, kolory, glitch
  acting.js              arkusze ekspozycji: każdy ruch, rysunek po rysunku
  capri.js               postać: postawy, teleport, siedzenie, zaglądanie, spadanie, rzucanie, inne ekrany, sen
  fx.js                  odłamki, kolumny światła, błyskawice, glify, linie prędkości, fale uderzeniowe, satelita i czerwone światło, opętane okna, zbliżenia, jej intro
  panel.js               panel „transmisji”, jej miny i pasek
  guide.js               jej przewodnik: samouczki, chodzenie do rzeczy i pokazywanie ich palcem
  brain.js               zamienia zdarzenia Claude'a na kwestie i akcje
  mission.js             dzisiejszy dziennik misji, do jej raportu
  chat.js                rozmowa z nią: rozmowa, kim jest, jej nadchodzące odpowiedzi
  reminders.js           przypomnienia: czytanie ich z twojej wiadomości, pilnowanie, kiedy przychodzi pora
  bond.js                jak bardzo jest z tobą zżyta, z czasem coraz bardziej, i jej zazdrość o inne AI
  look.js                patrzy na twój ekran: najpierw pyta, skan, co mówi o tym jej AI
  pc.js                  twój PC tak, jak go czuje: procesor, bateria, sieć, pendrive'y, gry
  files.js               szukanie twoich plików (indeks wyszukiwania Windows), zrzuty ekranu
  lines.js               co mówi (FR / EN / ES / PT / RU)
  chip.js                jej maska: kiedy śpi i w lewym dolnym rogu, kiedy ją schowasz
  voice.js               dźwięki
```

Do grzebania w niej: `npm run dev` włącza trasy debugowania na moście (`/debug/capture` zapisuje klatkę okna do `captures/`,
`/debug/testwin` otwiera okna testowe, na których może siadać, po jednym na nazwę, `/debug/mouse` przesuwa i klika zastępczym
kursorem nad oknem Capri, bez ruszania prawdziwego, `/debug/type` pisze w jej czacie, `/debug/menu` wylicza jej menu i może
kliknąć jego pozycję).
`npm run dist` buduje instalator Windows w `dist/`.

## Autorzy i prawa

Capri / Projekt Capricorn, Cyberpunk i Cyberpunk: Edgerunners należą do CD PROJEKT RED, Studio Trigger i Netflix.
To niekomercyjny projekt fanowski, bez żadnych powiązań. Obrazy postaci w `assets/capri/` pochodzą z klatek
serialu, fanowskiej wycinanki i fan artu (zbliżenia z jej intro); **nie** obejmuje ich licencja kodu.
Jeśli właściciel praw chce je usunąć, otwórz zgłoszenie.

**Licencja: za darmo, nigdy na sprzedaż.** Kod jest na [licencji PolyForm Noncommercial 1.0.0](LICENSE): możesz
jej używać, zmieniać ją i dzielić się tym, co zrobiłeś, za darmo. Sprzedawanie Capri albo czegokolwiek zrobionego z jej kodu
(klucze, subskrypcje, płatny dostęp, płatne zamówienia) jest zabronione. Wersje do 0.4.3 były na licencji MIT.

Kroje pisma: Chakra Petch i JetBrains Mono, na licencji SIL Open Font License, przez Fontsource.
