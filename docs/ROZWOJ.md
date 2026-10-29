# Rozwijanie Capri na innym komputerze

Kod żyje na GitHubie w forku (`nf-gh057/capri-desktop`). Każdy komputer może mieć swoją kopię roboczą: zmiany
przechodzą między nimi przez GitHuba (`git push` na jednym, `git pull` na drugim).

## Dwie Capri na jednym komputerze: zwykła i dev

- **Zwykła Capri** (z `install.ps1`): osobny folder `%LOCALAPPDATA%\Capri\capri-desktop`, nikt w nim nie pracuje,
  więc sama pobiera nowe wersje z GitHuba (Mainframe › Aktualizacje, a w roju automatycznie).
- **Capri dev** (kopia robocza, `npm run dev`): folder, w którym pisze się kod. Nowe wersje powstają tutaj, więc nie
  aktualizuje się sama: mogłaby wejść w drogę pracy w toku. Aktualizuje się ją przez git (`git pull`).

Obie korzystają z tych samych ustawień (`%APPDATA%\capri-desktop`) i tych samych portów: naraz może działać tylko
jedna. Przed `npm run dev` zamknij zwykłą Capri.

## Jednorazowo na nowym komputerze (PowerShell)

1. Narzędzia: Git, Node.js 20+, Tailscale i Claude Code. Najprościej skryptem (przy okazji instaluje zwykłą Capri):

   ```powershell
   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/nf-gh057/capri-desktop/main/install.ps1))) -Claude -Tailscale
   ```

2. Kopia robocza forka:

   ```powershell
   git clone https://github.com/nf-gh057/capri-desktop.git $HOME\Code\capri-desktop
   ```

3. Repozytorium autora oryginału jako `upstream`, z zablokowanym wysyłaniem (tylko do porównań i scalania):

   ```powershell
   git -C $HOME\Code\capri-desktop remote add upstream https://github.com/mochiiwuff/capri-desktop.git
   git -C $HOME\Code\capri-desktop remote set-url --push upstream DISABLED
   ```

4. Pakiety i start w trybie dev (w folderze kopii):

   ```powershell
   npm ci
   npm run dev
   ```

5. Przy pierwszym `git push` Windows poprosi o zalogowanie się do GitHuba (konto `nf-gh057`).

6. Zasady pracy nad forkiem są w `CLAUDE.md` w repozytorium: Claude Code na każdym komputerze czyta je sam.

## Na co dzień, gdy pracujesz na dwóch komputerach

- **Przed pracą** zawsze `git pull`, na każdym komputerze: inaczej zaczynasz od starszej wersji.
- **Po pracy** commit i `git push`; drugi komputer dostanie zmiany przy następnym `git pull`.
- **Numer wersji**: przed każdym commitem `npm run bump`. Liczy kolejny numer z historii, więc najpierw `git pull`.
  Jeśli oba komputery zrobią commit równolegle, oba dostaną ten sam numer (np. `0.4.4-13`) i przy scalaniu
  `package.json` wejdzie w konflikt: weź wersję z GitHuba i jeszcze raz `npm run bump`.
- **Rój**: Capri dev normalnie dołącza do roju (Mainframe › Rój › Dołącz), ale nie aktualizuje się z nim sama.
- **Testy**: `npm run test:hooks`, `test:phone`, `test:swarm`, `test:update`, `test:mind`.

## Gdyby coś poszło nie tak

- `git pull` mówi o lokalnych zmianach: zacommituj je albo odłóż (`git stash`), potem `git pull`, potem `git stash pop`.
- Capri dev nie startuje po `git pull`: zmieniły się pakiety, `npm ci` w folderze kopii.
- Konflikt w `README.fr.md` przy scalaniu upstreamu: plik ma zostać usunięty (`git rm README.fr.md`), a zmiany autora
  z `README.md` trzeba przenieść też do `README.pl.md`.
