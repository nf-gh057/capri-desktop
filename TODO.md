# TODO

## Wiadomości od Capri przez Discorda (bot, w obie strony)

Capri pisze do mnie w prywatnych wiadomościach na Discordzie, a ja mogę jej odpisać.

- Bot z Discord Developer Portal; token trzymany zaszyfrowany (DPAPI, jak klucze API w `setup.js`).
- Przyjmuje wiadomości tylko z mojego konta (ID użytkownika Discord), resztę ignoruje.
- Wysyła, kiedy jestem z dala od komputera (bezczynność / zablokowany ekran):
  Claude czeka na zgodę lub odpowiedź, zadanie się skończyło, błąd, wieczorny raport z misji (obrazek karty).
- Wiadomości w jej stylu, ze wszystkich języków w `lines.js`.
- Włączane świadomie (opt-in): README obiecuje, że nic nie opuszcza komputera. Wybór, ile treści wychodzi
  (sam fakt / fragment promptu lub odpowiedzi; nigdy zawartość plików). Limit wiadomości na minutę.
- Zdalny czat bez jej „mocy” na komputerze (otwieranie i zamykanie aplikacji wyłączone).
- Bez zatwierdzania zgód Claude z Discorda: przejęte konto Discord nie może oznaczać wykonania kodu na PC.
- Ustawienia w menu w zasobniku (włącz/wyłącz, token, moje ID, co wysyłać).
