// Talking to her: you type in her panel, and a model (setup.js picks which) answers as her, in
// writing. The replies are AI-generated, and the panel says so on every chat.
// She can do a few things on your PC when you ask (Windows): open an app or a game, play music or
// control what's playing, open a website, close an app. She spots what you want in what you wrote,
// or the model asks for it with a tag in its answer. Music right away; an app you named yourself
// right away; anything only the model asked for, a website, and closing an app behind a button.

import { pick, fmt } from './util.js';
import { ASSISTANT_NAMES } from './lines.js';
import { parseReminder, parseWhen, clock } from './reminders.js';

const REMEMBER = 20; // messages she has in mind when answering
const REMEMBER_LOCAL = 8; // the same, with a model on this PC standing in (no network): less to read, a quicker answer
const EREBUS_CHANCE = 0.08; // an answer through her Blackwall Gateway that brings Erebus in with it
// a message from your phone (her chat on Telegram): what her AI is told, by the message
const PHONE_NOTE = 'Note for you, never repeat it: the user is away from the PC and writes to you from their phone. You can\'t open apps, sites or music, play anything or set reminders for them now: if they ask, say so. Plain text, a few sentences at most.';
// ...from her app on your phone, where an order is that same message sent with the bolt on her bar
const POCKET_NOTE = 'Note for you, never repeat it: the user is away from the PC and writes to you from your app on their phone. A message like this one is only talk: you can\'t open apps, sites or music, play anything or set reminders from it. If they ask you to, tease them, short and cocky, with a storm or lightning touch: they forgot to switch on the bolt on your app\'s bar and send it again as an order (their fingerprint confirms it). Plain text, a few sentences at most.';
const ORDER_NOTE = 'Note for you, never repeat it: the user is away from the PC and gives you this from their phone, confirmed with their fingerprint. Opening apps, sites or music and setting reminders is done by Capri herself, right away, not by you: never say you opened or will open something. What you can do, changing files in your folder, do it, then say in a few plain sentences what you did.';
const PHONE_AGENT ='You only read here: change no file and run nothing that changes anything, even if asked; that waits until they\'re back at the PC.';
const KEEP = 60;     // messages she remembers across restarts (memory.json)
// her language, where small models need it: how she says "we" (else it's in English), and the last line
// of her prompt, in that language (they drift into the English of everything above it)
// `now`: the same, said again right by your message (small models answer in the language of the
// conversation so far, English after a switch, whatever the top of her prompt says)
const IN_LANGUAGE = {
  en: { we: '', last: 'Write everything in English, unless the user writes to you in another language: then in theirs.', now: 'Answer in English, unless this message is written in another language.' },
  pl: { we: '"my" in Polish', last: 'Pisz wszystko po polsku, chyba że użytkownik pisze do ciebie w innym języku: wtedy w jego. Tylko słówka ze slangu Night City zostają po angielsku, nigdy całe zdania. O sobie mówisz w rodzaju żeńskim (zrobiłam, widziałam).' , now: 'Odpowiadaj po polsku, chyba że ta wiadomość jest napisana w innym języku.' },
};
const LANGUAGE_NAMES = { en: 'English', pl: 'Polish' };
const STAY_MS = 10 * 60 * 1000; // no wandering off mid-conversation
const LOADING_AFTER_MS = 5000;
// her chat closes itself once you've stopped talking (nothing typed, no answer coming), so what
// Claude does comes through again: a minute, or a few seconds when something of it is waiting
const IDLE_MS = 60 * 1000;
const IDLE_MISSED_MS = 8 * 1000;
const CLOSE_TAG = /\[\[\s*close\s*:?\s*([^\]]*)\]\]/i; // [[close: AM Music]] at the end of her answer
// "close", "shut down", "ferme", "quitte", "cierra", "fecha", "закрой", "zamknij"... in any of her languages
const CLOSE_ASK = /\b(close|shut|quit|kill|exit)|ferm|quitt|coupe|arr[êe]t|cierr|cerra|fech|закр|выключ|zamkn|wyłącz|wylacz|zakończ|zakoncz|ubij|zabij/i;
// her other tags: [[open: Spotify]], [[music: Bad Bunny]], [[media: next]], [[site: youtube.com]]
const TAG = /\[\[\s*(open|music|media|site)\s*:\s*([^\]]*)\]\]/i;
// "open", "launch", "ouvre", "lance", "abre", "открой", "otwórz"... in any of her languages
const OPEN_ASK = /\b(open|launch|start|run)\b|ouvr|lance|démarre|abre|abrir|inicia|ejecuta|executa|открой|запусти|otwórz|otworz|odpal|uruchom|włącz|wlacz/i;
// what to do with the music playing, said plainly (only when it's about music, or said in a few words)
const MEDIA_ASK = [
  ['pause', /\b(pause|pausa|pausar)\b|stop (the )?music|arrête la musique|пауз|\bzapauzuj|zatrzymaj muzyk/i],
  ['next', /\b(next|skip|suivante?|siguiente|próxima|proxima)\b|passe (à )?la suivante|salta|pula|следующ|\bnastępn|\bnastepn|\bprzewiń|\bprzewin|\bpomiń|\bpomin/i],
  ['previous', /\b(previous|précédente?|anterior)\b|предыдущ|\bpoprzedni/i],
  ['play', /\b(resume|reprends|reanuda|retoma)\b|relance la musique|remets la musique|продолж|\bwznów|\bwznow/i],
  ['volup', /\b(louder|plus fort)\b|monte le son|turn (it )?up|sube el volumen|aumenta o volume|громче|głośniej|glosniej|podgłośnij|podglosnij/i],
  ['voldown', /\b(quieter|moins fort)\b|baisse le son|turn (it )?down|baja el volumen|abaixa o volume|тише|\bciszej|\bprzycisz|ścisz|\bscisz/i],
  ['mute', /\bmute\b|coupe le son|silencia|sem som|выключи звук|\bwycisz/i],
];
const MUSIC_WORD = /musi|chanson|song|track|titre|morceau|spotify|canci|faixa|песн|музык|трек|muzyk|piosenk|utw[oó]r/i;
// "put X on Spotify", "mets X sur Spotify", "pon X en Spotify", "coloca X no Spotify", "включи X в Spotify", "puść X na Spotify"
const SPOTIFY_ASK = /(?:play|put on|put|mets|joue|lance|écoute|pon|toca|reproduce|coloca|toque|включи|поставь|puść|pusc|włącz|wlacz|zagraj)\s+(?:moi\s+|me\s+|mi\s+)?(.+?)\s+(?:on|sur|en|no|na|в)\s+spotify/i;
const MEDIA_ACTIONS = new Set(MEDIA_ASK.map(([action]) => action));
// "mets Bohemian Rhapsody sur YouTube", "play Daft Punk on youtube"
const YOUTUBE_ASK = /(?:play|put on|put|mets|met|joue|lance|écoute|pon|toca|reproduce|coloca|bota|toque|включи|поставь|puść|pusc|zagraj|włącz|wlacz)(?:[- ]moi|[- ]me|me|\s+mi)?\s+(.+?)\s+(?:on|sur|en|no|na|в)\s+youtube/i;
// "mets Bohemian Rhapsody", "joue-moi du Daft Punk", "play some Queen": a song, or a game to play
const PLAY_ASK = /^(?:capri,?\s+)?(?:mets|met|joue|play|put on|pon|toca|coloca|bota|toque|включи|поставь|puść|pusc|zagraj)(?:[- ]moi|[- ]me|me|\s+mi)?\s+(.{2,100})$/iu;
// "joue à Brawlhalla", "play the game…": a game, not a song
const GAME_ASK = /^(?:capri,?\s+)?(?:(?:joue|play)\s+(?:à|au|aux|a|the game)|zagraj\s+w)\s/i;
// "du Daft Punk", "some Queen": who to play, without the "some"
const songOf = (s) => s
  .replace(/^(?:la |le |une? |the |some )?(?:musique|music|chanson|son|morceau|song|track|songs|muzyk[eęi]|piosenk[eęi]|utw[oó]r)\s+(?:de |d['’]|du |by |of |od )?/i, '')
  .replace(/^(?:(?:du|de la|de l['’]|des|de|some|un peu de|del|un poco de|algo de|um pouco de|troch[eę]|co[sś] z)\s+|d['’])/i, '')
  .replace(/\s+(?:on|sur|en|no|na|в)\s+youtube\s*$/i, '')
  .trim();
// "démarre YouTube et mets la musique de Daft Punk": the song asked for after an "and"
const PLAY_AFTER = /\s(?:et|and|y|e|и|i)\s+(?:mets|met|joue|play|put on|pon|toca|coloca|bota|включи|поставь|démarre|demarre|lance|start|launch|écoute|ecoute|puść|pusc|zagraj)(?:[- ]moi|[- ]me|\s+mi)?\s+(.{2,100})$/i;
// "lance la musique de Daft Punk", "start the song X": an app verb, but music right after it
const MUSIC_START = /^(?:capri,?\s+)?(?:lance|démarre|demarre|start|launch|écoute|ecoute|pon|toca|włącz|wlacz|odpal|puść|pusc)(?:[- ]moi|[- ]me|\s+mi)?\s+(?:la |le |une? |the |some )?(?:musique|music|chanson|son|morceau|song|track|canci[óo]n|m[úu]sica|песню|музыку|muzyk[eęi]|piosenk[eęi]|utw[oó]r)\s+(.{2,100})$/i;
// "mets ce que tu veux", "play whatever you want": she picks (her tag)
const HER_PICK = /tu veux|ton choix|surprends|you want|whatever|your choice|surprise me|quieras|tu elecci[óo]n|quiser|sua escolha|хочешь|на твой выбор|co chcesz|co zechcesz|tw[oó]j wyb[oó]r|zaskocz mnie|cokolwiek/i;
// what's left when it doesn't say which song ("mets de la musique", "play something")
const VAGUE_SONG = /^(?:(?:de\s+la|du|des|la|le|les|une?|some|a|the|un|algo\s+de|alguma|um|uma|что-нибудь|jak[aą][sś]|jaki[sś]|troch[eę])\s+)?(?:musique|music|son|sons|chanson|morceau|truc|quelque\s+chose|something|song|tunes?|m[úu]sica|canci[óo]n|algo|coisa|музыку|песню|muzyk[eęi]|piosenk[eęi]|co[sś])?\s*[.!?]*$/iu;
// "trouve mon CV", "où est le pdf du contrat", "find my report", "найди файл…": her search verbs, and
// what makes it a file on your PC or a search on the web
const SEARCH_VERB = /(?:cherche|recherche|trouve|retrouve|où (?:est|sont)|search(?: for)?|find|look (?:for|up)|where(?:'s| is| are)|busca|encuentra|d[óo]nde est[áa]n?|procura|acha|onde est[áa]o?|найди|поищи|где|znajd[źz]|wyszukaj|poszukaj|szukaj|gdzie (?:jest|s[ąa]))/i;
const FILE_WORD = /fichier|dossier|document|photo|image|vid[ée]o|\bpdf\b|\bfiles?\b|folder|archivo|carpeta|arquivo|pasta|файл|папк|\.\w{2,4}\b|sur mon (?:pc|ordi)|dans mes fichiers|on my (?:pc|computer)|en mi (?:pc|ordenador)|no meu (?:pc|computador)|на (?:компьютере|пк)|plik|katalog|dokument|zdj[eę]ci|obraz|wideo|na (?:moim )?(?:pc|komputerze|kompie)|w moich plikach/i;
const WEB_WORD = /google|internet|\ble web\b|the web|\bonline\b|en ligne|в интернете|в гугле|w sieci|w necie/i;
// "where's Notepad?", "show me the Spotify window", "où est le bloc-notes ?", "gdzie jest notatnik", "pokaż okno
// discorda": a window to find. Said with "window", it's surely one; without, only if one by that name is there.
const WINDOW_ASK = /^(?:capri,?\s+)?(?:where(?:'s| is| are)|o[uù] (?:est|sont)|d[óo]nde est[áa]n?|onde est[áa]o?|где|gdzie (?:jest|s[ąa]|mam)|show(?: me)?|find|montre(?:[- ]moi)?|trouve(?:[- ]moi)?|mu[ée]strame|encuentra|mostra(?:-me)?|me mostra|encontra|ache|покажи|найди|poka[żz](?: mi)?|znajd[źz](?: mi)?)\s+(.{2,60}?)[\s?!.]*$/iu;
const WINDOW_WORD = /\b(?:window|fen[êe]tre|ventana|janela)\b|окн[оае]|(?:^|\s)okn(?:o|a|ie)(?=\s|$)/iu;
// what's around its name: "the", "my", "window"…
const WINDOW_FILLER = /(?:^|\s)(?:the|my|its|le|la|les|l|ma|mon|el|mi|o|a|meu|minha|мой|моё|моя|mój|moj|moja|moje|window|fen[êe]tre|ventana|janela|окно|окна|okno|okna|oknie|de|du|da|do|of)(?=\s|$)/giu;
// "fais une capture d'écran", "take a screenshot"
const SHOT_ASK = /capture d['’][ée]cran|screenshot|screen ?shot|captura de (?:pantalla|tela)|скриншот|снимок экрана|zrzut(?:u)? ekranu|\bscreena?\b/i;

// Your PC itself (system.js). One of its settings pages: a settings word, or an open verb, before it.
const SETTINGS_WORD = /param[eè]tres?|r[ée]glages?|settings|configuraci[oó]n|configura[çc][õo]es|ajustes|настройк|ustawie[nń]/i;
const SETTINGS_PAGES = [
  ['bluetooth', /bluetooth/i],
  ['wifi', /wi-?fi|wlan/i],
  ['update', /mises? [àa] jour|\bupdates?\b|actualizaci|atualiza[çc]|обновлени|aktualizac/i],
  ['notifications', /notifications?|notificaci|notifica[çc]|уведомлен|powiadomie[nń]/i],
  ['background', /fond d['’][ée]cran|wallpaper|background|fondo de pantalla|papel de parede|обо(?:и|ев)\b|tapet|t[łl][ao] pulpitu/i],
  ['storage', /stockage|storage|almacenamiento|armazenamento|хранилищ|magazyn|pami[eę][cć] masow/i],
  ['mouse', /souris|\bmouse\b|rat[oó]n|мыш|mysz/i],
  ['battery', /batterie|battery|bater[ií]a|батаре|bateri/i],
  ['power', /alimentation|\bpower\b|energ[ií]a|питани|zasilani/i],
  ['display', /[ée]cran|display|pantalla|\btela\b|экран|дисплей|ekran|wy[śs]wietlacz/i],
  ['network', /r[ée]seau|network|(?<![\p{L}])rede?(?![\p{L}])|сет[ьи]|(?<![\p{L}])sie(?:ć|ci|c)(?![\p{L}])/iu],
  ['sound', /\bson\b|\bsound\b|audio|sonido|\bsom\b|звук|d[źz]wi[eę]k/i],
];
// what's left of it: asked as a question
const INFO_ASK = [
  ['battery', /batterie|battery|bater[ií]a|заряд|батаре|bateri/i],
  ['disk', /disque|\bdisk\b|\bdrive\b|stockage|storage|espace (?:libre|disque|restant)|de (?:la )?place|space left|free space|espacio|\bdisco\b|espa[çc]o|диск|места|dysk|miejsca/i],
  ['ram', /\bram\b|m[ée]moire|memory|memoria|mem[óo]ria|памят|озу|pami[eę][cć]/i],
  ['ip', /\bip\b|айпи/i],
];
const QUESTION = /\?|combien|\bquel(?:le)?\b|c['’]est quoi|\breste\b|how much|how many|what(?:'s| is)|\bleft\b|cu[aá]nt|\bqu[eé]\b|quanto|\bqual\b|сколько|как(?:ой|ая|ое)|осталось|\bile\b|\bjak[aiy]?\b|zosta[łl]o/i;
// its sound: "mets le son à 30 %", "volume 50"; off and back on
const VOLUME_ASK = /(?:\bson\b|volume|\bsound\b|volumen|\bsom\b|звук|громкост\w*|d[źz]wi[eę]k\S*|g[łl]o[śs]no[śs][ćc]\S*)\D{0,14}?(\d{1,3})\s*(?:%|pour ?cent|percent|por ?ciento|por ?cento|процент|procent)?/i;
const MUTE_ASK = /coupe le son|mets? (?:le son )?en muet|\bmute\b|silencia|tira o som|sem som|выключи звук|wycisz|wy[łl][ąa]cz d[źz]wi[eę]k/i;
const UNMUTE_ASK = /remets? le son|r[ée]active le son|unmute|sound (?:back )?on|quita el silencio|activa el sonido|volta o som|liga o som|включи звук|w[łl][ąa]cz d[źz]wi[eę]k|przywr[óo][cć] d[źz]wi[eę]k/i;
// a timer, counted down in her ticker
const TIMER_ASK = /minuteur|\btimer\b|temporizador|cron[oó]metro|таймер|minutnik|stoper/i;
// Windows' snip of an area (not her own screenshot of all of it)
const SNIP_ASK = /capture (?:d['’])?une (?:zone|partie)|zone de l['’][ée]cran|\bsnip\b|(?:capture|screenshot|captura) (?:of |de )?(?:an? |una |uma |la |a )?(?:area|region|part|zona|[aá]rea|parte)|снимок области|область экрана|wytnij (?:fragment|kawa[łl]ek)|fragment ekranu|wycinek ekranu/i;
// its windows: out of the way, back, or side by side
const TIDY_ASK = /range (?:mes|les|toutes les) fen[êe]tres|cache (?:mes|les|toutes les) fen[êe]tres|montre(?:-moi)? (?:le|mon) bureau|r[ée]duis (?:tout|toutes les fen[êe]tres)|tidy (?:up )?(?:my |the )?windows|minimi[sz]e (?:all|everything|my windows|the windows)|show (?:me )?(?:the |my )?desktop|ordena (?:mis |las )?ventanas|minimiza (?:todo|todas)|muestra el escritorio|organiza (?:minhas |as )?janelas|minimiza tudo|mostra a [áa]rea de trabalho|сверни (?:все|окна)|убери окна|покажи рабочий стол|posprz[ąa]taj (?:moje |wszystkie )?okna|schowaj (?:moje |wszystkie )?okna|zminimalizuj (?:wszystko|okna|wszystkie okna)|poka[żz] pulpit/i;
const UNTIDY_ASK = /(?:remets|ressors|rends-moi|rouvre) (?:mes|les) fen[êe]tres|(?:bring|put) (?:my |the )?windows back|restore (?:my |the )?windows|devu[ée]lve(?:me)? (?:mis |las )?ventanas|restaura (?:mis |las )?ventanas|volta (?:minhas |as )?janelas|traz (?:minhas |as )?janelas de volta|верни окна|przywr[óo][cć] (?:moje |wszystkie )?okna|oddaj (?:mi )?(?:moje )?okna/i;
const PLACE_VERB = /^\s*(?:mets?|place|bouge|d[ée]place|put|move|snap|pon|coloca|mueve|bota|поставь|перемести|сдвинь|ustaw|po[łl][óo][żz]|przesu[nń]|daj)\s+/i;
const SIDE = [
  ['left', /\s*(?:[àa] |on the |to the |a la |na |[àa] la )?(?:gauche|left|izquierda|esquerda|слева|влево|налево|(?:po |na )?lew(?:ej|o|[ąa]))(?![\p{L}])/iu],
  ['right', /\s*(?:[àa] |on the |to the |a la |na |[àa] la )?(?:droite|right|derecha|direita|справа|вправо|направо|(?:po |na )?praw(?:ej|o|[ąa]))(?![\p{L}])/iu],
];
// dark or light
const DARK_ASK = /mode sombre|th[eè]me sombre|mode nuit|dark mode|dark theme|modo oscuro|tema oscuro|modo escuro|tema escuro|т[её]мн(?:ая|ую) тем|т[её]мный режим|tryb ciemny|ciemny (?:tryb|motyw)|motyw ciemny/i;
const LIGHT_ASK = /mode clair|th[eè]me clair|light mode|light theme|modo claro|tema claro|светл(?:ая|ую) тем|светлый режим|tryb jasny|jasny (?:tryb|motyw)|motyw jasny/i;
// its power: always behind a button of hers but the cancel
const PC_WORD = /(?<![\p{L}])(?:pc|ordi\p{L}*|computer|ordenador|computador|компьютер\p{L}*|пк|komputer\p{L}*|kompa|kompie|komp|pecet\p{L}*|laptop\p{L}*)(?![\p{L}])/iu;
const POWER_ASK = [
  ['cancel', /annule (?:l['’])?(?:extinction|arr[êe]t|red[ée]marrage)|cancel (?:the )?(?:shut ?down|restart)|cancela (?:el |o )?(?:apagado|desligamento|reinicio)|отмени (?:выключение|перезагрузку)|anuluj (?:wy[łl][ąa]czenie|restart|ponowne uruchomienie)|odwo[łl]aj (?:wy[łl][ąa]czenie|restart)/i],
  ['restart', /red[ée]marre|reboot|restart|reinicia|reinicie|перезагру|zrestartuj|uruchom ponownie|restartuj/i],
  ['shutdown', /[ée]teins|shut ?down|turn off|power off|\bapaga\b|desliga|выключи|wy[łl][ąa]cz(?! d[źz]wi[eę]k)/i],
  ['sleep', /\bveille\b|\bsleep\b|suspend|suspen[dc]|спящ|u[śs]pij|u[śs]pienie|tryb u[śs]pienia/i],
  ['lock', /verrouill|\block\b|bloquea|bloqueia|заблокир|zablokuj/i],
];

// How long a timer is: "10 minutes", "1h30", "45 s" (else "dans une heure", as for a reminder).
function duration(text) {
  const hm = /(\d+)\s*h\s*(\d{1,2})\b/i.exec(text);
  if (hm) return (Number(hm[1]) * 60 + Number(hm[2])) * 60000;
  let ms = 0;
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)?)\s*(h|heures?|hours?|horas?|час\p{L}*|godz\p{L}*|min\p{L}*|m|мин\p{L}*|s|sec\p{L}*|seg\p{L}*|sek\p{L}*|сек\p{L}*)(?![\p{L}])/giu)) {
    const unit = m[2].toLowerCase();
    ms += Number(m[1].replace(',', '.')) * (/^(?:h|час|godz)/.test(unit) ? 3600000 : /^(?:m|мин)/.test(unit) ? 60000 : 1000);
  }
  if (ms) return ms;
  const when = parseWhen(text);
  return when ? Math.max(0, when.at - Date.now()) : 0;
}

// 1 h 30, 10 min, 45 s
function span(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
}

// what's left, in her ticker: 9:59, 1:02:03
function left(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const two = (n) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
}
// the words that aren't what to look for
const NOT_SEARCHED = new Set(('stp svp please pls peux tu can you could would puedes pode можешь moi me le la les l mon ma mes '
  + 'un une des du de d the my a an for of el mi mis o meu minha meus мой мою мои sur dans on in en no na на в pc ordi ordinateur '
  + 'computer ordenador computador компьютере fichier fichiers dossier dossiers document documents photo photos image images '
  + 'vidéo vidéos video videos file files folder folders archivo archivos carpeta carpetas arquivo arquivos pasta pastas файл '
  + 'файлы папка папку appelé appelée nommé called named llamado chamado qui s appelle est sont is are where où cherche recherche '
  + 'trouve retrouve search find look up busca encuentra procura acha найди поищи где dónde onde google internet web online ligne '
  + 'proszę prosze możesz mozesz mi mój moj moja moje moich moim na w z o pc komputerze kompie plik pliki plików plikach katalog '
  + 'dokument dokumenty zdjęcie zdjęcia obraz obrazy wideo który która które nazywa się gdzie jest są znajdź znajdz wyszukaj '
  + 'poszukaj szukaj internecie sieci necie').split(' '));
// the kind of file asked for: "mon projet after effect" is a .aep
const FILE_TYPES = [
  [/after ?effects?/i, ['aep']], [/premi[eè]re/i, ['prproj']], [/photoshop|\bpsd\b/i, ['psd']], [/illustrator/i, ['ai']],
  [/blender/i, ['blend']], [/cinema ?4d|\bc4d\b/i, ['c4d']], [/fl ?studio/i, ['flp']], [/ableton/i, ['als']],
  [/\bword\b|\bdocx?\b/i, ['docx', 'doc']], [/excel|\bxlsx?\b|tableur|spreadsheet|arkusz/i, ['xlsx', 'xls', 'csv']],
  [/powerpoint|\bpptx?\b|diapo|slides|prezentacj/i, ['pptx', 'ppt']], [/\bpdf\b/i, ['pdf']],
  [/vid[ée]os?\b|\bmp4\b|\bfilms?\b|v[íi]deo|видео|wideo|filmik|\bfilmy\b/i, ['mp4', 'mov', 'mkv', 'avi', 'webm']],
  [/photos?\b|images?\b|\bpng\b|\bjpe?g\b|imagen|imagem|фото|zdj[eę]ci|obraz/i, ['png', 'jpg', 'jpeg', 'webp', 'heic']],
  [/musiques?\b|\bmp3\b|\baudio\b|\bsongs?\b|музык|muzyk|piosenk/i, ['mp3', 'wav', 'flac', 'm4a', 'ogg']],
  [/\bzip\b|\barchive|\barchiw|\brar\b|\b7z\b/i, ['zip', 'rar', '7z']],
];
const fileTypes = (text) => [...new Set(FILE_TYPES.filter(([re]) => re.test(text)).flatMap(([, exts]) => exts))];
// words that only say what kind of file it is, or what to do with it once found
const NOT_A_NAME = new Set(('and et y e и it ça ca lo la o open ouvre ouvrir ouvres abre abrir открой show montre affiche '
  + 'projet projets project projects proyecto projeto проект after effect effects premiere pro photoshop illustrator blender cinema '
  + '4d c4d fl studio ableton word excel powerpoint pdf mp4 mp3 png jpg jpeg zip rar 7z film films musique musiques music song songs '
  + 'audio présentation presentation diapo slides tableur spreadsheet dernier dernière derniers last latest récent récents recent '
  + 'nouveau new psd docx doc xlsx pptx i otwórz otworz pokaż pokaz go ją ja je projekt projekty ostatni ostatnia ostatnie najnowszy '
  + 'najnowsza najnowsze nowy nowa nowe filmy muzyka prezentacja prezentację arkusz').split(' '));
// "…and open the folder", "…et ouvre-le": what to do with what she found
const THEN_FOLDER = /(?:ouvre|ouvrir|open|show|montre|abre|abrir|открой|покажи|otwórz|otworz|pokaż|pokaz)\s+(?:moi\s+|mi\s+)?(?:le |la |the |its |son |el |a |o |jego |ten )?(?:dossier|folder|carpeta|pasta|папку|katalog)/i;
const THEN_OPEN = /(?:et|and|y|e|и|i)\s+(?:l['’])?(?:ouvre|open|lance|abre|открой|otwórz|otworz|odpal|uruchom)(?:[- ](?:le|la|les)|\s+(?:it|them|lo|la|o|его|её|go|ją|je))?\s*[.!?]*$/i;
const searched = (text) => text.replace(/^\s*capri[,!:]?\s+/i, '').toLowerCase().split(/[^\p{L}\p{N}.]+/u).filter((w) => w && !NOT_SEARCHED.has(w)).join(' ');
// a Roblox game by its name: "in my roblox play steal a brain rot", "lance grow a garden sur roblox"
const ROBLOX_VERB = /(?:^|\s)(?:play|joue(?:r)?(?: à| a)?|lance|launch|start|ouvre|open|mets|go to|va sur|juega(?: a)?|jogue|jogar|запусти|включи|zagraj(?: w)?|odpal|uruchom|włącz|wlacz|otwórz|otworz)\s+/gi;
function robloxGame(text) {
  if (!/roblox/i.test(text)) return null;
  let rest = null;
  for (const m of text.matchAll(ROBLOX_VERB)) rest = text.slice(m.index + m[0].length); // after the last verb
  if (!rest) return null;
  const name = rest
    .replace(/\s+(?:on|in|sur|dans|en|no|na|в|w)\s+(?:my\s+|mon\s+|mi\s+|meu\s+|moim\s+)?roblox\b.*$/i, '')
    .replace(/\broblox\b/ig, '')
    .replace(/^(?:à|a|au|to|le jeu|the game|un jeu|el juego|o jogo)\s+/i, '')
    .replace(/\s+(?:stp|svp|please|pls|por favor|plis)\b.*$/i, '').replace(/\s+prosz[eę].*$/i, '')
    .replace(/[\s.!?,]+$/, '')
    .trim();
  return name.length >= 2 ? name : null;
}
// "regarde mon écran", "tu vois quoi ?", "what's on my screen?", "что ты видишь?"
const LOOK_ASK = /regarde (?:mon|l['’]|ce que)|(?:jette|jeter) un (?:œil|oeil)|tu vois quoi|qu['’]est[- ]ce que tu vois|look at (?:my|the|this) screen|what(?:'s| is) on my screen|what do you see|take a look|mira (?:mi|la) pantalla|qu[ée] ves|olha (?:minha|a) tela|o que voc[êe] v[êe]|посмотри на (?:мой )?экран|что ты видишь|(?:popatrz|zerknij|sp[oó]jrz) na (?:m[oó]j )?ekran|co widzisz|co (?:jest|mam) na (?:moim )?ekranie/i;
// what her tag needs to find in your message before it does anything: a small model tags answers about
// anything ("[[music: synthwave]]" under a film tip), and music and the media keys act right away
const LISTEN = /[ée]cout|listen|escuch|\bouv(ir|e)\b|слуша|playlist|album|\b(play|joue|mets|pon|toca|coloca)\b|включи|поставь|słucha|slucha|\bpuść|\bpusc|\bzagraj/i;
const SOUND = /\b(sound|volume|volumen)\b|\b(le|du|au) son\b|\bo som\b|звук|громк|dźwięk|\bdzwiek|głośnoś|\bglosnos/i; // not "son": "his" in French
const PLAY = /\bjou(er|e)\b|\bplay\b|jugar|juega|jogar|joga|играть|поигра|\bzagra|\bpogra|\bgra[cć]/i;
const SITE = /\b(site|web|page|lien|link|url|enlace|p[aá]gina|stron)|сайт|ссылк|\.(com|fr|org|net|io|gg|tv|be|ch|ca|es|br|pt|ru|pl)\b/i;
// "appelle-moi Max", "call me Max", "llámame Max", "me chama de Max", "зови меня Макс", "mów mi Max"
const NAME_ASK = /(?:appelle[- ]moi|call me|my name is|je m['’]appelle|ll[aá]mame|me llamo|me cham[ae] de|meu nome [eé]|зови меня|меня зовут|m[oó]w do mnie|m[oó]w mi|nazywam si[eę]|mam na imi[eę])\s+([\p{L}\p{N}'’-]{1,24})/iu;
// "souviens-toi que…", "remember that…", "recuerda que…", "lembra que…", "запомни, что…", "zapamiętaj, że…" (said first thing)
const MEMO_ASK = /^\s*(?:capri,?\s+|stp,?\s+|please,?\s+|prosz[eę],?\s+)?(?:souviens[- ]toi(?: que| de)?|n['’]oublie pas(?: que| de)?|remember(?: that)?|recuerda(?: que)?|lembr[ae](?:-se)?(?: que| de)?|запомни,?(?: что)?|(?:za)?pami[eę]taj,?(?: [zż]e)?|nie zapomnij,?(?: [zż]e)?)\s+(.{3,200})/iu;
const MEMORIES_MAX = 30;
// sites asked for by name ("open youtube") when no app on the PC goes by it: the address is hers, not
// the model's, so it opens right away like an app you named
const SITES = {
  youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com',
  twitch: 'https://www.twitch.tv', netflix: 'https://www.netflix.com', reddit: 'https://www.reddit.com',
  twitter: 'https://x.com', instagram: 'https://www.instagram.com', tiktok: 'https://www.tiktok.com',
  facebook: 'https://www.facebook.com', github: 'https://github.com', chatgpt: 'https://chatgpt.com',
  wikipedia: 'https://www.wikipedia.org', linkedin: 'https://www.linkedin.com', pinterest: 'https://www.pinterest.com',
  crunchyroll: 'https://www.crunchyroll.com', outlook: 'https://outlook.live.com', whatsapp: 'https://web.whatsapp.com',
  discord: 'https://discord.com/app', soundcloud: 'https://soundcloud.com', deezer: 'https://www.deezer.com',
};
// a browser named with a site ("open youtube on chrome"): the site, in the browser you use
const BROWSER = /chrome|edge|firefox|opera|brave|vivaldi|duckduckgo|browser/i;
// local models this small mostly talk nonsense ("llama3.2:1b", "qwen2.5:0.5b"…)
const TINY = /[:-](0\.5b|1b|1\.5b|135m|270m|360m)\b/i;
// her face when she greets you in a mood (bond.js)
// a model's name as her chat shows it: without Ollama's ":latest" and Gemini's "models/"
const short = (model) => String(model || '').replace(/:latest$/, '').replace(/^models\//, '');

const MOOD_FACE = { angry: 'many', sulk: 'aside', dizzy: 'wide', thrown: 'wide', jealous: 'look', fun: 'laugh', happy: 'laugh', forgiven: 'smug' };

// A message of your chat, with what tells it apart on all your PCs (her swarm, main.js): an id, and when
const note = (role, content, at = Date.now()) => ({ role, content, id: crypto.randomUUID().replaceAll('-', '').slice(0, 16), at });
// what her AI gets of one: who said what, nothing else (what you sent Claude Code or Codex, said so: she
// talked about it on her own, talk.js)
const said = ({ role, content, to }) => ({ role, content: to ? `(The user sent this to ${to}, their coding assistant, not to you:) ${content}` : content });

export class Chat {
  constructor({ capri, panel, voice, host, brain }) {
    this.capri = capri;
    this.panel = panel;
    this.voice = voice;
    this.host = host;
    this.brain = brain;
    this.history = []; // your chats with her, [{ role, content, id, at }], kept by main.js across restarts
    this.warm = false; // a model already answered this run (Ollama's first answer waits for it to load)
    this.open = false;
    this.turn = 0;     // id of the answer coming in, if any
    this.answer = '';
    this.apps = [];    // the apps open on this PC, as last listed: [{ name, label }]
    this.appsReady = Promise.resolve();
    this.showModel = true; // the model's name in her chat's header (Mainframe can hide it)
    this.showNote = true;  // the line under her chat saying an AI answers, not her (same)
    this.onSetup = null; // (status) => void: she can't answer yet (app.js hands it to setup.js)
    this.onBetterModel = null; // () => void: a bigger model than the tiny one she's on (setup.js)
    this.care = null;          // care.js: taking care of your PC (app.js sets it)
    this.reminders = null; // the reminders she keeps (reminders.js, from app.js)
    this.bond = null;      // how close she is to you (bond.js)
    this.jealousy = null;  // and how she takes your other AIs
    this.onMessage = null; // () => void: you said something to her
    this.waitingWhen = null; // a reminder you asked for without saying when: { text, until }
    host.onChatDelta(({ id, text }) => this.onDelta(id, text));
    this.lastActive = 0;
    panel.chatInput.addEventListener('input', () => { this.lastActive = performance.now(); });
    setInterval(() => this.closeIfIdle(), 2000);
    // your chats as they are on all your PCs now (her swarm): taken in, unless she's answering
    host.onChatHistory?.((history) => {
      if (!this.turn && Array.isArray(history)) this.history = history;
    });
  }

  get t() {
    return this.brain.t.chat;
  }

  async start() {
    const { capri, host, t } = this;
    if (this.open) {
      host.focusOverlay(true); // the keyboard back, if you clicked elsewhere since
      this.panel.chatInput.focus();
      return;
    }
    if (capri.stowed) {
      host.setConfig({ visible: true });
      await capri.unstow();
    }
    capri.wake();
    const status = await host.chatStatus();
    if (!status.ok && this.onSetup) {
      this.onSetup(status); // nothing to talk with yet: she sets it up with you, with buttons (setup.js)
      return;
    }
    if (!status.ok) {
      // no Ollama, or nothing to talk with yet: what to do about it
      const offline = status.error === 'offline';
      const other = !offline && status.error !== 'nomodel'; // another provider, saying why
      capri.perform('curious', capri.towardCenter());
      this.panel.say({
        kind: 'info',
        face: 'aside',
        guide: true,
        line: other ? t.failed : offline ? t.offline : t.noModel,
        quote: other ? status.error : offline ? t.offlineHow : t.noModelHow,
        actions: offline
          ? [{ id: 'get', label: t.getOllama, primary: true }, { id: 'ok', label: t.ok }]
          : [{ id: 'ok', label: t.ok, primary: true }],
        onAction: (id) => {
          if (id === 'get') host.openOllama();
          this.panel.hide();
        },
        hold: null,
      });
      return;
    }
    this.history = await host.chatMemory().catch(() => this.history); // "forget" in her menu may have emptied it
    this.cold = status.warmup && !this.warm;
    this.agent = Boolean(status.agent); // Claude Code (or Codex) answers, as her, and really works in your project
    this.agentName = status.provider === 'codex' ? 'Codex' : 'Claude Code';
    this.powersOn = status.powers !== false; // her apps, sites and music (with an agent, if asked in her settings)
    this.listApps();
    const shortModel = short(status.model);
    this.mind = { model: status.model, local: status.local }; // who answers, as her chat shows it
    this.elsewhere = false; // a model on this PC answering instead (no network)
    const tiny = status.provider === 'ollama' && TINY.test(status.model) && this.onBetterModel;
    // angry, sulking, dizzy…: she greets you the way she feels, and her model is told she did
    const feeling = this.bond?.feeling;
    const moody = !tiny && feeling && t.moody[feeling];
    const hello = moody ? fmt(pick(moody), this.bond.mood.vars) : pick(this.history.length ? t.again : t.hello);
    this.opening = moody ? hello : null;
    host.focusOverlay(true); // the keyboard, for typing to her
    const shown = this.panel.say({
      kind: 'chat',
      face: moody ? MOOD_FACE[feeling] : 'look',
      badge: t.badge,
      tag: this.brainInfo(status.model, status.local).tag,
      line: tiny ? fmt(t.tiny, { model: shortModel }) : hello,
      actions: tiny ? [{ id: 'better', label: t.better, primary: true }] : [],
      onAction: () => {
        this.panel.hide(); // her chat holds off her guide's panels: it goes first
        this.onBetterModel?.();
      },
      chat: {
        placeholder: t.placeholder,
        send: t.send,
        close: t.close,
        ...this.brainInfo(status.model, status.local).chat,
      },
      onSend: (text) => this.send(text),
      onLeave: () => this.close(),
      hold: null,
    });
    if (!shown) {
      host.focusOverlay(false); // something more important is on (a permission prompt)
      return;
    }
    this.open = true;
    this.lastActive = performance.now();
    setTimeout(() => this.panel.chatInput.focus(), 150); // once the overlay has the keyboard
    capri.perform('hop');
    capri.nextMove = capri.nextGaze = performance.now() + STAY_MS;
  }

  // You stopped talking a while ago: her chat goes, unless you're halfway through typing something
  closeIfIdle() {
    if (!this.open || this.turn || this.panel.chatInput.value.trim() || !this.panel.current?.chat) return;
    const idle = performance.now() - this.lastActive;
    if (idle > (this.panel.missed ? IDLE_MISSED_MS : IDLE_MS)) this.panel.hide();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    if (this.turn) this.host.chatStop(this.turn);
    this.turn = 0;
    this.host.focusOverlay(false);
    this.capri.nextMove = performance.now() + 30000;
    this.capri.nextGaze = performance.now() + 60000;
  }

  async send(text) {
    if (this.turn || !this.open) return;
    const id = Date.now();
    this.turn = id;
    this.answer = '';
    this.history.push(note('user', text));
    this.panel.setChatBusy(true);
    this.panel.setActions([]); // a close button she offered before goes with a new message
    this.panel.chatTurn({ quote: text, face: 'aside' });
    this.capri.pulse();
    this.onMessage?.();
    // what you asked for plainly happens right away (a reminder, the music, the volume, an app you
    // named): her line about it comes under her answer (Claude Code or Codex, answering her chat, does
    // things on the PC its own way, unless her powers are on for them too)
    const asked = this.asked(text);
    if (asked?.kind === 'look') return this.sendLook(text, id);
    if (asked?.kind === 'care') return this.sendCare(asked, id);
    const early = asked && asked.kind !== 'close' ? this.doNow(asked) : null;
    // a window she looked for herself: what she found is her whole answer (her AI would only guess)
    const found = asked?.kind === 'window' && (await early.catch(() => null));
    if (found && this.turn === id) {
      this.turn = 0;
      this.remember({ role: 'assistant', content: found.line });
      this.panel.setChatBusy(false);
      this.lastActive = performance.now();
      return this.after('', '…', asked, early, text);
    }
    this.bond?.heard(text); // "sorry": she lets it go
    await Promise.race([this.appsReady, new Promise((r) => setTimeout(r, 1500))]);
    // what she greeted you with (angry, sulking…), in the conversation before your message, so her
    // answer carries on from it (after another answer of hers: added to that one, never two in a row)
    if (this.opening) {
      const at = this.history.length - 1;
      const before = this.history[at - 1];
      if (before?.role === 'assistant') this.history[at - 1] = { ...before, content: `${before.content}\n${this.opening}` };
      else this.history.splice(at, 0, note('assistant', this.opening, (this.history[at]?.at || Date.now()) - 1));
      this.opening = null;
    }
    const messages = this.messages();
    // nothing yet after a few seconds: Ollama is still loading the model (the first answer after a start),
    // or Claude Code is at work
    const wait = this.agent ? this.t.working : this.cold ? this.t.loading : null;
    const slow = wait && setTimeout(() => {
      if (this.turn === id && !this.answer) this.panel.stream(wait);
    }, LOADING_AFTER_MS);
    // main.js failing outright (a bug, not a model's no): said like any failure, never a chat stuck waiting
    const failed = (err) => ({ ok: false, error: String(err?.message || err).replace(/^Error invoking remote method '[^']+': /, '') });
    let res = await this.host.chatSend({ id, messages }).catch(failed);
    // No network, and her brain lives online: a model on this PC answers instead, as her (no agent,
    // no tools of its own), and she says so under her answer.
    let elsewhere = ''; // the line under her answer, when a model on this PC gave it
    if (!res.ok && res.code === 'offline' && res.local && this.turn === id) {
      clearTimeout(slow); // "Claude Code is at work" isn't so
      const agent = this.agent;
      this.agent = false;
      const local = this.messages(REMEMBER_LOCAL);
      this.agent = agent;
      res = await this.host.chatSend({ id, messages: local, local: res.local }).catch(failed);
      if (res.ok) elsewhere = fmt(this.t.offlineLocal, { model: short(res.local) });
    }
    // her header and note follow: the model on this PC while it answers, hers again once it's back
    if (res.ok && Boolean(elsewhere) !== this.elsewhere) {
      this.elsewhere = Boolean(elsewhere);
      this.panel.setChatInfo(elsewhere ? this.brainInfo(res.local, true) : this.brainInfo(this.mind.model, this.mind.local));
    }
    clearTimeout(slow);
    if (this.turn !== id) {
      // closed meanwhile: your message goes too, or the next answer would answer it as well
      if (this.history.at(-1)?.content === text) this.history.pop();
      return;
    }
    this.turn = 0;
    if (!res.ok) {
      this.history.pop();
      this.panel.setFace('wide');
      // too busy or gone even after trying other models (main.js): said plainly, not the server's JSON
      this.panel.stream(res.code === 'busy' ? this.t.swamped : res.code === 'gone' ? this.t.gone
        : res.code === 'offline' ? this.t.offline : `${this.t.failed} ${res.error}`, { done: true });
      this.panel.setChatBusy(false);
      return;
    }
    const said = clean(res.text) || '…';
    this.warm = true;
    this.remember({ role: 'assistant', content: said });
    const answer = elsewhere ? `${said}\n${elsewhere}` : said; // as shown: with the line about her brain offline
    this.panel.stream(answer, { done: true });
    this.panel.setFace(mood(said));
    this.panel.setChatBusy(false);
    this.lastActive = performance.now();
    if (this.powersOn || asked) this.after(res.text, answer, asked, early, text);
    this.listApps(); // fresh for the next message
  }

  // A message from your phone (her chat on Telegram, or her page over Tailscale: main.js askHer): the
  // same conversation and memory, with nothing shown here and none of her powers (whatever she says
  // she'd open stays unopened). Claude
  // Code or Codex only read for it, main.js sees to that. { ok, text } or { ok: false, error }
  async fromPhone(id, text) {
    while (this.turn) await new Promise((resolve) => setTimeout(resolve, 500)); // what you typed here first
    const status = await this.host.chatStatus().catch(() => ({ ok: false, error: 'offline' }));
    if (!status.ok) return { ok: false, error: status.error === 'offline' ? this.t.offline : status.error || '…' };
    if (!this.open) this.history = await this.host.chatMemory().catch(() => this.history);
    const pocket = String(id).startsWith('pocket-'); // her app, not Telegram (main.js askHer)
    // her app, asked for something of her powers without the bolt on: no order, and she says so herself,
    // cocky, without asking her AI (Telegram never gives orders: her AI says it can't, as before)
    if (pocket && this.wantsPowers(text)) {
      const line = pick(this.t.bolt);
      this.history.push(note('user', text));
      this.remember({ role: 'assistant', content: line });
      this.onMessage?.();
      return { ok: true, text: line };
    }
    const agent = this.agent;
    const name = this.agentName;
    this.agent = Boolean(status.agent);
    this.agentName = status.provider === 'codex' ? 'Codex' : 'Claude Code';
    // where you are, said by your message (her prompt stays the one Codex already knows)
    const away = (messages) => {
      const last = messages.at(-1);
      messages[messages.length - 1] = { ...last, content: `${last.content}\n\n(${pocket ? POCKET_NOTE : PHONE_NOTE}${this.agent ? ` ${PHONE_AGENT}` : ''})` };
      return messages;
    };
    this.history.push(note('user', text));
    let res = await this.host.chatSend({ id, messages: away(this.messages()) }).catch((err) => ({ ok: false, error: err.message }));
    if (!res.ok && res.code === 'offline' && res.local) {
      this.agent = false;
      res = await this.host.chatSend({ id, messages: away(this.messages(REMEMBER_LOCAL)), local: res.local }).catch((err) => ({ ok: false, error: err.message }));
    }
    this.agent = agent;
    this.agentName = name;
    if (!res.ok) {
      if (this.history.at(-1)?.content === text) this.history.pop();
      return { ok: false, error: res.code === 'offline' ? this.t.offline : res.code === 'busy' ? this.t.swamped : res.error || '…' };
    }
    const said = clean(res.text) || '…';
    this.remember({ role: 'assistant', content: said });
    this.onMessage?.();
    return { ok: true, text: said };
  }

  // A message typed in Mainframe's HOLO (main.js streams her answer there): the same conversation and
  // memory, at your PC, so what you ask plainly (a reminder, the music, an app you named) happens and
  // her line about it follows her answer. What only her AI asked for (a button here) stays undone.
  // `order`: an order from her app on your phone, confirmed with your fingerprint (main.js), done the same
  // way, with its tag in her chat and her AI told you're away and it may act. `act`: what she does of it
  // (the order without the PC's name); a short order that's only a name ("Chrome") opens it.
  async fromDesk(id, text, { order = '', act = text } = {}) {
    while (this.turn) await new Promise((resolve) => setTimeout(resolve, 500)); // what you typed here first
    const status = await this.host.chatStatus().catch(() => ({ ok: false, error: 'offline' }));
    if (!status.ok) return { ok: false, error: status.error === 'offline' ? this.t.offline : status.error || '…' };
    if (!this.open) this.history = await this.host.chatMemory().catch(() => this.history);
    const { agent, agentName, powersOn } = this;
    this.agent = Boolean(status.agent);
    this.agentName = status.provider === 'codex' ? 'Codex' : 'Claude Code';
    this.powersOn = status.powers !== false || Boolean(order);
    this.history.push(order ? { ...note('user', text), tag: order } : note('user', text));
    this.capri.pulse();
    this.onMessage?.();
    this.bond?.heard(text);
    const short = order && act.split(/\s+/).length <= 4 && !/\?/.test(act);
    // "shut down Legion": the PC's name was the order's "my PC" (main.js orderTarget took it out of `act`)
    this.orderPc = Boolean(order) && act !== text;
    const asked = this.asked(order ? act : text) || (short ? { kind: 'open', text: act } : null);
    this.orderPc = false;
    const early = asked && !['close', 'look'].includes(asked.kind) ? this.doNow(asked).catch(() => null) : null;
    // a window she looked for herself: what she found is her whole answer (her AI would only guess)
    const found = asked?.kind === 'window' && (await early);
    if (found?.line) {
      Object.assign(this, { agent, agentName, powersOn });
      this.remember({ role: 'assistant', content: found.line });
      return { ok: true, text: found.line };
    }
    // an order from your phone: where you are and what it may do, said by your message
    const told = (messages) => {
      if (!order) return messages;
      const last = messages.at(-1);
      messages[messages.length - 1] = { ...last, content: `${last.content}\n\n(${ORDER_NOTE})` };
      return messages;
    };
    let res = await this.host.chatSend({ id, messages: told(this.messages()) }).catch((err) => ({ ok: false, error: err.message }));
    if (!res.ok && res.code === 'offline' && res.local) {
      this.agent = false;
      res = await this.host.chatSend({ id, messages: told(this.messages(REMEMBER_LOCAL)), local: res.local }).catch((err) => ({ ok: false, error: err.message }));
    }
    Object.assign(this, { agent, agentName, powersOn });
    if (!res.ok) {
      if (this.history.at(-1)?.content === text) this.history.pop();
      return { ok: false, error: res.code === 'offline' ? this.t.offline : res.code === 'busy' ? this.t.swamped : res.error || '…' };
    }
    let done = await early;
    // her PC's power, ordered from your phone: your fingerprint on the order is the click on her button
    if (order && done?.confirm) done = await this.powerOrder(done.confirm);
    const said = clean(res.text) || '…';
    this.warm = true;
    const all = done?.line ? `${said}\n${done.line}` : said;
    this.remember({ role: 'assistant', content: all });
    return { ok: true, text: order ? all : said }; // to your phone: what she did too ("Chrome: on it.")
  }

  // Taking care of your PC (care.js): done without her AI (quicker, and it works with the internet
  // down), her line about it as her answer, with its buttons.
  async sendCare(asked, id) {
    const slow = setTimeout(() => {
      if (this.turn === id) this.panel.stream(this.care.t.working);
    }, 1500);
    const done = await this.care.now(asked).catch(() => null);
    clearTimeout(slow);
    if (this.turn !== id) return;
    this.turn = 0;
    const line = done?.line || this.care.t.failed;
    this.remember({ role: 'assistant', content: line });
    this.panel.stream(line, { done: true });
    this.panel.setFace(done?.face || 'aside');
    this.panel.setChatBusy(false);
    if (done?.buttons?.length) this.offer(done, line);
  }

  // Her buttons for what she found: each click does its part, its line under hers, then its own
  // buttons, the others left if it says so (again), and a line for later when it's a long job.
  offer(done, answer) {
    this.panel.setActions(done.buttons, async (id) => {
      this.panel.setActions([]);
      const next = await Promise.resolve(done.onButton(id)).catch(() => null);
      if (next?.line) this.addLine(answer, next.line, next.face);
      const said = next?.line ? `${answer}\n${next.line}` : answer;
      if (next?.buttons?.length) this.offer(next, said);
      else if (next?.again) {
        const rest = done.buttons.filter((b) => b.id !== id);
        if (rest.length) this.offer({ ...done, buttons: rest.map((b, i) => ({ ...b, primary: i === 0 })) }, said);
      }
      next?.later?.then((last) => last && this.care.tell(last.line, last.face));
    });
  }

  // "Look at my screen" in her chat: she looks (asking you first, the first time) and answers here,
  // the conversation so far in mind.
  async sendLook(text, id) {
    const tl = this.brain.t.look;
    const say = (line, face = 'aside') => {
      if (this.turn !== id) return;
      this.turn = 0;
      this.remember({ role: 'assistant', content: line });
      this.panel.stream(line, { done: true });
      this.panel.setFace(face);
      this.panel.setChatBusy(false);
    };
    if (!this.look.asked) {
      const where = await this.host.lookWhere().catch(() => ({}));
      this.history.pop(); // your message comes back once you've said yes
      say(`${tl.ask} ${fmt(where.local ? tl.local : tl.online, { model: where.model || '…', service: where.provider || '' })}`, 'look');
      this.panel.setActions([{ id: 'yes', label: tl.yes, primary: true }, { id: 'no', label: tl.no }], async (choice) => {
        this.panel.setActions([]);
        if (choice !== 'yes') {
          this.interject(tl.declined, [], null);
          return;
        }
        await this.host.setConfig({ lookAsked: true });
        this.look.asked = true;
        this.send(text);
      });
      return;
    }
    const snap = await this.host.lookSnap();
    if (!snap.ok) return say(fmt(tl.failed, { error: snap.error }));
    this.look.effect();
    const res = await this.host.lookSay({
      id: snap.id,
      persona: this.lookPersona(),
      history: this.history.slice(-REMEMBER, -1).map(said),
      prompt: `${text}\n\n(Note for you, never repeat it: the picture is the user's screen right now; a small figure with a big red mane on it is you. Answer about what you really see, in character. ${this.languageNote()})`,
    });
    if (!res.ok) {
      const model = String(res.model || '…').replace(/:latest$/, '');
      return say(res.code === 'novision' ? fmt(tl.noVision, { model }) : res.code === 'noai' ? tl.noAI : fmt(tl.failed, { error: res.error || '…' }));
    }
    const answer = clean(res.text).replace(/^["“«]\s*|\s*["”»]$/g, '') || '…';
    this.seen = { text: answer, at: Date.now() };
    return say(answer, mood(answer));
  }

  // Her chat's header tag and the note under it, for `model` answering (on this PC or not): each one
  // hidden if you said so in Mainframe
  brainInfo(model, local) {
    const { t } = this;
    return {
      tag: this.showModel ? short(model) : '',
      chat: { noteTag: t.noteTag, note: this.showNote ? (local ? t.note : t.noteCloud) : '' },
    };
  }

  // What her AI gets: who she is, then the conversation. Her mood (angry, sulking…) and her language
  // are said again right by your message, for this answer only. Small local models mostly go by the
  // last thing they read: up in her prompt alone, they forget it (and answer in English after a
  // conversation in English).
  messages(remember = REMEMBER) {
    const messages = [{ role: 'system', content: this.persona() }, ...this.history.slice(-remember).map(said)];
    if (!this.agent) {
      const mood = this.bond?.moodLine().replace(/^Right now: /, '');
      const last = messages.at(-1);
      messages[messages.length - 1] = { ...last, content: `${last.content}\n\n(Note for you, never repeat it: ${[mood, this.languageNote()].filter(Boolean).join(' ')})` };
    }
    return messages;
  }

  // an answer of hers, kept with your message before it
  remember(message) {
    this.history.push(message.id ? message : note(message.role, message.content));
    this.history = this.history.slice(-KEEP);
    this.host.chatRemember(this.history);
  }

  listApps() {
    this.appsReady = this.host.openApps().then((list) => { this.apps = list || []; }).catch(() => {});
  }

  // Whether your message asks for something of her powers (an app, music, a reminder, your PC...): what
  // asked() reads off it with her powers on, short of your name or a memory to keep (those she does anyway).
  wantsPowers(text) {
    const { powersOn } = this;
    this.powersOn = true;
    try {
      const asked = this.asked(text);
      return Boolean(asked) && !['name', 'memo'].includes(asked.kind);
    } finally {
      this.powersOn = powersOn;
    }
  }

  // What you asked plainly, read off your message (a small model doesn't always write its tag right):
  // { kind: 'media', action } | { kind: 'music', song } | { kind: 'close', name } | { kind: 'open', text }
  asked(text) {
    const count = text.trim().split(/\s+/).length;
    if (this.reminders) {
      const remind = parseReminder(text);
      if (remind) return { kind: 'remind', ...remind };
      // the time, said after she asked when ("dans 10 min")
      const w = this.waitingWhen;
      const when = w && Date.now() < w.until && count <= 6 && parseWhen(text);
      if (when && when.at > Date.now()) return { kind: 'remind', at: when.at, text: w.text };
    }
    const name = NAME_ASK.exec(text)?.[1];
    if (name) return { kind: 'name', name };
    const memo = MEMO_ASK.exec(text)?.[1]?.trim();
    if (memo) return { kind: 'memo', text: memo };
    if (!this.powersOn) return null; // the rest is her powers on the PC
    if (this.look && LOOK_ASK.test(text)) return { kind: 'look' };
    const pc = this.askedPc(text, count);
    if (pc) return pc;
    if (SHOT_ASK.test(text)) return { kind: 'shot' };
    const roblox = robloxGame(text);
    if (roblox) return { kind: 'roblox', game: roblox };
    if (SEARCH_VERB.test(text) && WEB_WORD.test(text) && searched(text)) return { kind: 'web', query: searched(text) };
    const exts = fileTypes(text);
    if (SEARCH_VERB.test(text) && (FILE_WORD.test(text) || exts.length)) {
      const query = searched(text).split(' ').filter((w) => w && !NOT_A_NAME.has(w)).join(' ');
      const then = THEN_FOLDER.test(text) ? 'folder' : THEN_OPEN.test(text) ? 'open' : null;
      if (query || exts.length) return { kind: 'files', query, exts, then };
    }
    const where = WINDOW_ASK.exec(text.trim());
    if (where) {
      const name = where[1].replace(/['’]/g, ' ').replace(WINDOW_FILLER, ' ').replace(/\s+/g, ' ').trim();
      if (name.length >= 2) return { kind: 'window', name, sure: WINDOW_WORD.test(text) };
    }
    const media = MEDIA_ASK.find(([, re]) => re.test(text))?.[0];
    if (media && (count <= 5 || MUSIC_WORD.test(text))) return { kind: 'media', action: media };
    const song = SPOTIFY_ASK.exec(text)?.[1];
    if (song) return { kind: 'music', song };
    const video = YOUTUBE_ASK.exec(text)?.[1];
    if (video) return { kind: 'youtube', song: songOf(video) };
    const app = this.askedToClose(text);
    if (app) return { kind: 'close', name: app };
    if (GAME_ASK.test(text) && count <= 8) return { kind: 'open', text };
    const start = MUSIC_START.exec(text.trim())?.[1];
    if (start && !HER_PICK.test(start)) return { kind: 'play', song: songOf(start.replace(/[\s.!?]+$/, '')) };
    const both = PLAY_AFTER.exec(text.trim());
    const after = both?.[1];
    // "ouvre discord et lance spotify": the first half too
    if (after && !VAGUE_SONG.test(after) && !HER_PICK.test(after)) return { kind: 'play', song: songOf(after.replace(/[\s.!?]+$/, '')), before: text.trim().slice(0, both.index) };
    const play = PLAY_ASK.exec(text.trim())?.[1];
    if (play && !VAGUE_SONG.test(play) && !HER_PICK.test(play)) return { kind: 'play', song: songOf(play.replace(/[\s.!?]+$/, '')) };
    if (OPEN_ASK.test(text) && count <= 14) return { kind: 'open', text };
    return null;
  }

  // Something to do to your PC itself (system.js), read off your message: { kind: 'pc', what, ... }
  askedPc(text, count) {
    const care = this.care?.asked(text, count);
    if (care) return care;
    const pc = (what, more = {}) => ({ kind: 'pc', what, ...more });
    const power = POWER_ASK.find(([, re]) => re.test(text))?.[0];
    if (power === 'cancel') return pc('power', { power });
    // an order from your phone naming the PC ("shut down Legion"): the power word alone, maybe with when
    const named = this.orderPc && text.replace(/\s+(?:za|in|dans|en|em|через)\s.*$/i, '').trim().split(/\s+/).length <= 1;
    if (power && (PC_WORD.test(text) || named || (['lock', 'sleep'].includes(power) && count <= 4))) {
      const when = ['shutdown', 'restart'].includes(power) && parseWhen(text);
      return pc('power', { power, seconds: when ? Math.round((when.at - Date.now()) / 1000) : 30 });
    }
    if (SNIP_ASK.test(text)) return pc('snip');
    if (UNTIDY_ASK.test(text)) return pc('tidy', { back: true });
    if (TIDY_ASK.test(text)) return pc('tidy');
    if (DARK_ASK.test(text)) return pc('theme', { dark: true });
    if (LIGHT_ASK.test(text)) return pc('theme', { dark: false });
    if (TIMER_ASK.test(text)) {
      const ms = duration(text);
      if (ms >= 1000) return pc('timer', { ms });
    }
    if (count <= 10) {
      const level = VOLUME_ASK.exec(text)?.[1];
      if (level && Number(level) <= 100) return pc('volume', { level: Number(level) });
      if (UNMUTE_ASK.test(text)) return pc('volume', { mute: false });
      if (MUTE_ASK.test(text)) return pc('volume', { mute: true });
    }
    // "mets Discord à gauche et Chrome à droite"
    if (PLACE_VERB.test(text) && SIDE.some(([, re]) => re.test(text))) {
      const places = text.split(/\s+(?:et|and|y|e|и|i|oraz)\s+/i).map((part) => {
        const side = SIDE.find(([, re]) => re.test(part));
        if (!side) return null;
        const name = part.replace(PLACE_VERB, '').replace(side[1], '').replace(/\b(?:la|le|les|l['’]|the|el|o|a|fen[êe]tre|window|ventana|janela|окно|okno)\b/gi, '').replace(/[\s.!?,]+/g, ' ').trim();
        return name.length >= 2 ? { name, side: side[0] } : null;
      }).filter(Boolean);
      if (places.length) return pc('arrange', { places });
    }
    if (count <= 12) {
      const page = SETTINGS_PAGES.find(([, re]) => re.test(text))?.[0];
      if (page && SETTINGS_WORD.test(text)) return pc('settings', { page });
      const info = INFO_ASK.find(([, re]) => re.test(text))?.[0];
      if (info && (QUESTION.test(text) || count <= 3)) return pc('info', { info });
      if (page && OPEN_ASK.test(text)) return pc('settings', { page });
    }
    return null;
  }

  // Doing it to your PC (system.js through host.pcDo): her line about it, a button first for its power.
  async pcNow(asked) {
    const t = this.t.pc;
    const run = (req) => this.host.pcDo(req);
    const gb = (bytes) => `${(bytes / 1024 ** 3).toFixed(bytes < 100 * 1024 ** 3 ? 1 : 0)} ${t.gb}`;
    switch (asked.what) {
      case 'settings':
        this.zap();
        return (await run({ action: 'settings', page: asked.page })) ? { line: fmt(t.settings, { page: t.pages[asked.page] }), face: 'smug' } : null;
      case 'info': {
        const r = await run({ action: 'info', what: asked.info });
        if (!r) return null;
        if (asked.info === 'battery') {
          if (r.none) return { line: t.noBattery, face: 'look' };
          return { line: fmt(r.charging ? t.charging : t.battery, { percent: r.percent }), face: r.percent < 20 && !r.charging ? 'wide' : 'look' };
        }
        if (asked.info === 'disk') return { line: fmt(t.disk, { free: gb(r.free), total: gb(r.total), drive: r.drive }), face: 'look' };
        if (asked.info === 'ram') return { line: fmt(t.ram, { used: gb(r.used), total: gb(r.total) }), face: 'look' };
        return { line: r.ip ? fmt(t.ip, { ip: r.ip }) : t.noIp, face: 'look' };
      }
      case 'volume': {
        this.capri.pulse();
        const r = await run({ action: 'volume', level: asked.level, mute: asked.mute });
        if (!r) return null;
        return { line: asked.mute === true ? t.muted : asked.mute === false ? t.unmuted : fmt(t.volume, { level: r.level }), face: 'smug' };
      }
      case 'timer': {
        const time = span(asked.ms);
        const r = this.reminders.add(Date.now() + asked.ms, fmt(t.timerDone, { time }), { timer: true });
        this.countdown();
        return { line: fmt(t.timer, { time }), face: 'smug', reminder: r.id };
      }
      case 'snip':
        // she'd be in it: out of the way while you pick
        document.documentElement.style.visibility = 'hidden';
        setTimeout(() => { document.documentElement.style.visibility = ''; }, 2500);
        return (await run({ action: 'snip' })) ? { line: t.snip, face: 'smug' } : null;
      case 'tidy': {
        if (asked.back) return (await run({ action: 'tidy', back: true })) ? { line: t.back, face: 'smug' } : null;
        // she sweeps them off one after the other, front first, then they go
        const wins = this.capri.windows.wins.slice(0, 6);
        this.zap();
        wins.forEach((w, i) => setTimeout(() => {
          this.capri.fx.slices(w.x, w.y, w.w, Math.min(w.h, 500), { count: 8, life: 220 });
          this.voice.play('bolt', { soft: true });
        }, 120 + i * 110));
        await new Promise((r) => setTimeout(r, 200 + wins.length * 110));
        return (await run({ action: 'tidy' })) ? { line: t.tidy, face: 'laugh' } : null;
      }
      case 'arrange': {
        this.zap();
        const lines = [];
        for (const { name, side } of asked.places) {
          const r = await run({ action: 'arrange', name, side });
          lines.push(r?.found ? fmt(t.placed, { app: r.name, side: t.sides[side] }) : fmt(t.notOpen, { app: name }));
        }
        return { line: lines.join('\n'), face: 'smug' };
      }
      case 'theme':
        this.zap();
        return (await run({ action: 'theme', dark: asked.dark })) ? { line: asked.dark ? t.dark : t.light, face: 'smug' } : null;
      case 'power': {
        if (asked.power === 'cancel') {
          await run({ action: 'power', what: 'cancel' });
          this.shutdown = null;
          return { line: t.cancelled, face: 'look' };
        }
        const timed = ['shutdown', 'restart'].includes(asked.power);
        const when = timed && asked.seconds > 35 ? fmt(t.in, { time: span(asked.seconds * 1000) }) : t.now;
        return { line: fmt(t.ask[asked.power], { when }), face: 'many', confirm: { ...asked, seconds: timed ? Math.max(30, asked.seconds) : 0, when } };
      }
      default:
        return null;
    }
  }

  // An order from your phone for your PC's power, signed with your fingerprint (main.js): done at once,
  // her line about it going back to your phone. Null if Windows wouldn't.
  async powerOrder(confirm) {
    const t = this.t.pc;
    if (!(await this.host.pcDo({ action: 'power', what: confirm.power, seconds: confirm.seconds }))) return null;
    if (!['shutdown', 'restart'].includes(confirm.power)) return { line: t.doneNow[confirm.power], face: 'smug' };
    this.shutdown = { at: Date.now() + confirm.seconds * 1000, what: confirm.power };
    this.countdown();
    return { line: fmt(t.planned[confirm.power], { when: confirm.when }), face: 'smug' };
  }

  // Your click on her button for your PC's power: done, or left alone.
  async powerNow(confirm, answer) {
    const t = this.t.pc;
    this.panel.setActions([]);
    if (!(await this.host.pcDo({ action: 'power', what: confirm.power, seconds: confirm.seconds }))) return;
    if (['shutdown', 'restart'].includes(confirm.power)) {
      this.shutdown = { at: Date.now() + confirm.seconds * 1000, what: confirm.power };
      this.countdown();
      this.addLine(answer, fmt(t.planned[confirm.power], { when: confirm.when }), 'smug');
    }
  }

  // Her countdowns in her ticker (a timer, the PC about to shut down), the soonest, whenever it
  // isn't showing Claude at work.
  countdown() {
    clearInterval(this.counting);
    const tick = () => {
      const t = this.t.pc;
      const now = Date.now();
      const timer = this.reminders?.upcoming.find((r) => r.timer && r.at > now);
      const items = [
        timer && { at: timer.at, verb: t.timerVerb },
        this.shutdown?.at > now && { at: this.shutdown.at, verb: t.powerVerb[this.shutdown.what] },
      ].filter(Boolean).sort((a, b) => a.at - b.at);
      const shown = this.panel.tickerAction;
      if (!items.length) {
        clearInterval(this.counting);
        if (shown?.countdown) this.panel.setTicker(null);
        return;
      }
      if (shown && !shown.countdown) return; // Claude at work comes first
      this.panel.setTicker({ verb: items[0].verb, target: left(items[0].at - now), thinking: true, countdown: true });
    };
    tick();
    this.counting = setInterval(tick, 1000);
  }

  // Doing it now. Resolves with her line about it ({ line, face }), or null if there was nothing to do.
  async doNow(asked) {
    if (asked.kind === 'pc') return this.pcNow(asked);
    const { t } = this;
    if (asked.kind === 'window') return this.findWindow(asked);
    const custom = this.brain.custom;
    if (asked.kind === 'remind') {
      if (!asked.at) {
        this.waitingWhen = { text: asked.text, until: Date.now() + 3 * 60 * 1000 }; // her answer asks when
        return null;
      }
      this.waitingWhen = null;
      const r = this.reminders.add(asked.at, asked.text); // set before her answer is asked for: she knows
      const tr = this.brain.t.remind;
      return { line: fmt(r.text ? tr.set : tr.setBare, { time: clock(r.at, this.brain.lang), text: r.text }), face: 'smug', reminder: r.id };
    }
    if (asked.kind === 'name') {
      custom.userName = asked.name; // her answer, being written now, already knows it
      this.host.setConfig({ userName: asked.name });
      return { line: fmt(this.brain.t.custom.named, { name: asked.name }), face: 'laugh' };
    }
    if (asked.kind === 'memo') {
      custom.memories = [...(custom.memories || []).filter((m) => m !== asked.text), asked.text].slice(-MEMORIES_MAX);
      this.host.setConfig({ memories: custom.memories });
      return { line: this.brain.t.custom.remembered, face: 'smug' };
    }
    if (asked.kind === 'media') {
      this.capri.pulse();
      return (await this.host.media(asked.action)) ? { line: t.media[asked.action], face: 'smug' } : null;
    }
    if (asked.kind === 'music') {
      this.zap();
      return (await this.host.music(asked.song)) ? { line: fmt(t.music, { song: asked.song }), face: 'laugh' } : null;
    }
    if (asked.kind === 'youtube') return this.youtube(asked.song);
    if (asked.kind === 'roblox') {
      this.zap();
      const res = await this.host.roblox(asked.game);
      if (!res) return null;
      if (!res.name) return { line: fmt(t.robloxNone, { game: asked.game }), face: 'aside' };
      return { line: fmt(res.app ? t.robloxPlay : t.robloxPage, { game: res.name }), face: 'laugh' };
    }
    if (asked.kind === 'web') {
      this.zap();
      return (await this.host.webSearch(asked.query)) ? { line: fmt(t.web, { query: asked.query }), face: 'smug' } : null;
    }
    if (asked.kind === 'files') {
      const results = await this.host.searchFiles({ query: asked.query, exts: asked.exts });
      const asking = asked.query || asked.exts.map((e) => `.${e}`).join(' ');
      if (!results.length) return { line: fmt(t.filesNone, { query: asking }), face: 'aside' };
      const list = results.slice(0, 3).map((f) => `${f.name} (${f.folder})`).join(', ');
      const lines = [fmt(results.length === 1 ? t.fileFound : t.filesFound, { count: results.length, list })];
      // "…and open the folder" / "…and open it": done right away, on the newest one
      if (asked.then === 'folder' && (await this.host.openFile(results[0].path, true))) lines.push(fmt(t.folderOpened, { name: results[0].name }));
      // (never a program or a script on its own: that one waits for its button)
      const runs = /\.(exe|bat|cmd|ps1|vbs|vbe|js|jse|wsf|msi|reg|scr|com|jar|hta)$/i.test(results[0].name);
      if (asked.then === 'open' && !runs && (await this.host.openFile(results[0].path))) lines.push(fmt(t.opened, { app: results[0].name }));
      return { line: lines.join('\n'), face: 'smug', files: results };
    }
    if (asked.kind === 'shot') {
      // not her nor her panel in it
      document.documentElement.style.visibility = 'hidden';
      await new Promise((r) => setTimeout(r, 180));
      const shot = await this.host.screenshot();
      document.documentElement.style.visibility = '';
      this.voice.play('tick');
      return shot ? { line: fmt(t.shot, { name: shot.name }), face: 'smug', files: [shot] } : null;
    }
    if (asked.kind === 'play') {
      // what came before an "and" first ("ouvre discord et…"), unless it's YouTube, where the song goes anyway
      const first = asked.before && OPEN_ASK.test(asked.before) && !/youtube/i.test(asked.before)
        ? await this.doNow({ kind: 'open', text: asked.before }) : null;
      // "joue à Brawlhalla" is a game, "lance spotify" an app; anything else, a song
      const game = await this.host.findLaunch(asked.song);
      const then = game && ['steam', 'epic', 'app', 'file'].includes(game.kind) && !game.risky ? await this.openNow(game) : await this.youtube(asked.song);
      if (!first?.line) return then;
      return { line: [first.line, then?.line].filter(Boolean).join('\n'), face: then?.face || first.face };
    }
    const item = await this.host.findLaunch(asked.text);
    const site = namedSite(asked.text);
    if (site && (!item || BROWSER.test(item.name))) {
      this.zap();
      return (await this.host.openSite(site.url)) ? { line: fmt(t.siteOpened, { site: site.name }), face: 'laugh' } : null;
    }
    if (!item) return null; // nothing by that name here: her tag may still say what you meant
    return this.openNow(item);
  }

  // A window you asked her to find: she points at it (brought up first if it's minimized or covered).
  // Only close to what you said (a typo, another name): she asks if that's the one. None: she offers to
  // start it. Without the word "window", a typo counts only in a single word ("notatnk"), and an app
  // to start only by that name (else: her chat answers).
  async findWindow({ name, sure }, moved = false) {
    const { t } = this;
    const found = await this.host.findWindow(name).catch(() => null);
    // its button is on another screen's taskbar: she goes there, and looks again from there
    if (found?.stack?.display != null && !moved && this.goScreen) {
      await this.goScreen(found.stack.display);
      return this.findWindow({ name, sure }, true);
    }
    if (found?.stack) return this.showStack(found.stack);
    if (found?.id && !found.similar) return this.showWindow(found);
    // close to it (a typo, another name): asked about, when it's surely a window, or one long word
    const word = /^[\p{L}\p{N}-]{5,}$/u.test(name);
    if (found?.id) return sure || word ? { line: fmt(pick(t.windowSimilar), { asked: name, app: found.name }), face: 'look', window: found } : null;
    const item = found?.launch;
    if (item && (sure || simple(item.name).includes(simple(name)))) {
      return { line: fmt(pick(t.windowNone), { app: this.nameOf(item) }), face: 'aside', launchOffer: item };
    }
    return sure ? { line: fmt(pick(t.windowNowhere), { asked: name }), face: 'aside' } : null;
  }

  async showWindow(found) {
    const { capri, t } = this;
    const visible = () => {
      const win = capri.windows.wins.find((w) => w.id === found.id);
      return win && capri.canPoint(win) ? win : null;
    };
    const wait = async () => {
      for (let i = 0; i < 15 && !win; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        win = visible();
      }
    };
    let win = visible();
    if (!win) {
      // minimized, behind others, or on another screen: brought up, and pointed at once it shows (on
      // another screen, she goes there first)
      const up = await this.host.showWindow(found.id).catch(() => null);
      await wait();
      if (!win && up?.display != null && this.goScreen) {
        await this.goScreen(up.display);
        await wait();
      }
      if (!win) return { line: fmt(pick(t.windowUp), { app: found.name }), face: 'smug' };
    }
    this.point(win, found.name);
    return { line: fmt(pick(t.windowHere), { app: found.name }), face: 'smug' };
  }

  // Several windows of that app (or one she only sees there): its button on the taskbar, where you pick
  // the one you want, and each one by its title, a button each (`pick`). No button for it on her
  // screen: she only says so.
  // With several, she spreads her arms over its button and they fan out of it ("pick one"), held while
  // you choose.
  showStack({ name, count, rect, pick: wins = [] }) {
    const { t, capri } = this;
    if (rect && count >= 2) {
      capri.offerAt(rect, { label: `${name} ×${count}`, count, titles: wins.map((w) => w.title) }).then(() => {
        const at = capri.pointing;
        setTimeout(() => {
          if (at && capri.pointing === at) capri.stopPointing();
        }, wins.length >= 2 ? 30000 : 9000);
      });
    } else if (rect) this.point(rect, name);
    return { line: fmt(pick(count >= 2 ? t.windowMany : t.windowHere), { app: name, count }), face: 'smug', choose: wins.length >= 2 ? wins : null };
  }

  // she points at it a while, then lets it go (unless she's pointing at something else by then)
  point(rect, label) {
    const { capri } = this;
    capri.pointAt(rect, { label }).then(() => {
      const at = capri.pointing;
      setTimeout(() => {
        if (at && capri.pointing === at) capri.stopPointing();
      }, 8000);
    });
  }

  // An app, a game, a file or a folder: opened, or behind a button when it would run something.
  async openNow(item) {
    if (item.risky) return { offer: item };
    this.zap();
    const res = await this.host.launch(item);
    const name = this.nameOf(item);
    return { line: res.ok ? fmt(this.t.opened, { app: name }) : `${this.t.failed} ${res.error}`, face: res.ok ? 'laugh' : 'aside' };
  }

  // how she calls it: a folder like Downloads in her words, anything else by its name
  nameOf(item) {
    return item.kind === 'known' ? this.t.folders[item.id] || item.name : item.name;
  }

  // The song itself on YouTube (the right video, not a search), in your browser.
  async youtube(song) {
    this.zap();
    const res = await this.host.youtube(song);
    if (!res) return null;
    return { line: res.title ? fmt(this.t.youtube, { title: res.title }) : fmt(this.t.youtubeSearch, { song }), face: 'laugh' };
  }

  // Once she has answered: her line about what she did, else the app you asked to close, else what
  // her tag asks for, if your message (text) asked for that kind of thing.
  async after(raw, answer, asked, early, text) {
    const { t } = this;
    // her Blackwall Gateway open (her powers, with Claude Code or Codex): now and then something from
    // beyond the Blackwall comes through with them and has her a while (capri.js erebusIn)
    if (this.agent && this.powersOn && Math.random() < EREBUS_CHANCE) this.capri.erebusIn();
    const done = early && (await early);
    if (done?.reminder) {
      // a reminder set: a button to take it back, right there
      this.addLine(answer, done.line, done.face);
      const tr = this.brain.t.remind;
      this.panel.setActions([{ id: 'cancel', label: tr.cancel }], () => {
        this.reminders.remove(done.reminder);
        this.panel.setActions([]);
        this.addLine(answer, tr.cancelled, 'aside');
      });
      return undefined;
    }
    if (done?.offer) return this.launch(done.offer, answer); // it would run something: your click first
    if (done?.launchOffer) {
      // no such window open: start it? (on your click)
      this.addLine(answer, done.line, done.face);
      return this.launch(done.launchOffer, answer);
    }
    if (done?.window) {
      // only close to what you said: is it that one?
      this.addLine(answer, done.line, done.face);
      this.panel.setActions([{ id: 'yes', label: t.windowYes, primary: true }, { id: 'no', label: t.windowNo }], async (id) => {
        this.panel.setActions([]);
        if (id !== 'yes') return;
        const shown = await this.showWindow(done.window);
        this.addLine(answer, shown.line, shown.face);
      });
      return undefined;
    }
    if (done?.choose) {
      // several windows of it: which one, by its title (she brings it up and points at it)
      this.addLine(answer, done.line, done.face);
      this.panel.setActions(done.choose.map((w) => ({ id: String(w.id), label: w.title.length > 34 ? `${w.title.slice(0, 33)}…` : w.title })), async (id) => {
        const win = done.choose.find((w) => String(w.id) === id);
        this.panel.setActions([]);
        if (!win) return;
        // her fan of them out of the button: the one you picked lifts out of it, lit, a moment
        const fan = this.capri.pointing?.fan && this.capri.pointing.pointer;
        if (fan) {
          fan.pick(done.choose.indexOf(win));
          await new Promise((resolve) => setTimeout(resolve, 380));
        }
        const shown = await this.showWindow({ id: win.id, name: win.title });
        this.addLine(answer, shown.line, shown.face);
      });
      return undefined;
    }
    if (done?.confirm) {
      // your PC's power: her two buttons
      this.addLine(answer, done.line, done.face);
      const t = this.t.pc;
      this.panel.setActions([{ id: 'yes', label: t.yes[done.confirm.power], primary: true }, { id: 'no', label: t.no }], (id) => {
        if (id === 'yes') return this.powerNow(done.confirm, answer);
        this.panel.setActions([]);
        return this.addLine(answer, t.kept, 'look');
      });
      return undefined;
    }
    if (done?.files) {
      // what she found (or the screenshot): a button to open the first, and to see where it is
      this.addLine(answer, done.line, done.face);
      const [first, second] = done.files;
      const actions = [{ id: 'open', label: fmt(t.openIt, { app: first.name }), primary: true }];
      if (second) actions.push({ id: 'second', label: fmt(t.openIt, { app: second.name }) });
      actions.push({ id: 'folder', label: t.showFolder });
      this.panel.setActions(actions, (id) => {
        if (id === 'folder') return this.host.openFile(first.path, true);
        return this.host.openFile((id === 'second' ? second : first).path);
      });
      return undefined;
    }
    if (done) return this.addLine(answer, done.line, done.face);
    if (asked?.kind === 'remind') return undefined; // no time said: her answer asks when
    if (asked?.kind === 'close') return this.offerClose(asked.name, answer);
    if (asked && asked.kind !== 'open') return undefined; // music that didn't work out: nothing more to offer
    const closeTag = tagged(raw);
    if (closeTag) return wanted('close', text) ? this.offerClose(closeTag, answer) : undefined;
    const tag = TAG.exec(raw);
    if (!tag) return undefined;
    const kind = tag[1].toLowerCase();
    const value = tag[2].trim();
    if (!value || !wanted(kind, text)) return undefined;
    if (kind === 'media') return MEDIA_ACTIONS.has(value.toLowerCase()) ? this.media(value.toLowerCase(), answer) : undefined;
    // a song she picked: on YouTube, the right video (on Spotify if that's what you said)
    if (kind === 'music') return /spotify/i.test(text) ? this.music(value, answer) : this.playOn(value, answer);
    if (kind === 'site') return this.offerSite(value, answer);
    const item = await this.host.findLaunch(value);
    if (item) return this.launch(item, answer);
    const site = namedSite(value); // "[[open: YouTube]]": a site, not an app
    return site ? this.offerSite(site.url, answer) : this.addLine(answer, fmt(t.notInstalled, { app: value }));
  }

  // her answer, with a line of what she did under it
  addLine(answer, line, face = null) {
    if (!this.open || this.turn) return;
    this.panel.stream(answer === '…' ? line : `${answer}\n${line}`, { done: true }); // nothing but a tag: just the line
    if (face) this.panel.setFace(face);
  }

  // a bolt of red lightning off her fingers, at whatever she's doing on your PC
  zap() {
    const h = this.capri.head();
    this.capri.zap(h.x + this.capri.towardCenter() * 280, h.y - 170);
  }

  // An app or a game her tag asked for: behind a button (now: the button was clicked).
  async launch(item, answer, { now = false } = {}) {
    const { t } = this;
    if (!this.open || this.turn) return;
    if (!now) {
      this.panel.setActions(
        [{ id: 'open', label: fmt(t.openIt, { app: this.nameOf(item) }), primary: true }, { id: 'no', label: t.no }],
        (id) => (id === 'open' ? this.launch(item, answer, { now: true }) : this.panel.setActions([])),
      );
      return;
    }
    this.panel.setActions([]);
    this.zap();
    const res = await this.host.launch(item);
    this.addLine(answer, res.ok ? fmt(t.opened, { app: this.nameOf(item) }) : `${t.failed} ${res.error}`, res.ok ? 'laugh' : 'aside');
  }

  async playOn(song, answer) {
    const done = await this.youtube(song);
    if (done) this.addLine(answer, done.line, done.face);
  }

  // The media keys: pause, next, louder…
  async media(action, answer) {
    this.capri.pulse();
    const ok = await this.host.media(action);
    if (ok) this.addLine(answer, this.t.media[action], 'smug');
  }

  // A Spotify search, in the app if it's there.
  async music(song, answer) {
    this.zap();
    const ok = await this.host.music(song);
    if (ok) this.addLine(answer, fmt(this.t.music, { song }), 'laugh');
  }

  // A website: always behind a button that shows where it goes.
  offerSite(address, answer) {
    const { t } = this;
    let host;
    try {
      host = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`).hostname;
    } catch {
      return;
    }
    if (!this.open || this.turn || !host.includes('.')) return;
    this.panel.setActions(
      [{ id: 'site', label: fmt(t.siteIt, { site: host }), primary: true }, { id: 'no', label: t.no }],
      async (id) => {
        this.panel.setActions([]);
        if (id !== 'site') return;
        const ok = await this.host.openSite(address);
        if (ok) this.addLine(answer, fmt(t.siteOpened, { site: host }));
      },
    );
  }

  // "close am music pls": an app that's open, named in a message asking to close something.
  askedToClose(text) {
    if (!CLOSE_ASK.test(text)) return null;
    const said = simple(text);
    let best = null;
    for (const app of this.apps) {
      for (const name of [simple(app.name), simple(app.label)]) {
        if (name.length >= 3 && said.includes(name) && (!best || name.length > best.length)) best = { app, length: name.length };
      }
    }
    return best?.app.name || null;
  }

  // She was asked to close an app: a button with its name, and nothing happens until you click it.
  async offerClose(wanted, answer) {
    const { t } = this;
    const app = await this.host.findApp(wanted);
    if (!this.open || this.turn) return;
    if (!app) {
      this.panel.stream(`${answer}\n${fmt(t.notFound, { app: wanted })}`, { done: true });
      return;
    }
    this.panel.setActions(
      [{ id: 'close', label: fmt(t.closeIt, { app: app.name }), primary: true }, { id: 'no', label: t.no }],
      (id) => (id === 'close' ? this.closeApp(app) : this.panel.setActions([])),
    );
  }

  async closeApp(app, force = false) {
    const { t, capri } = this;
    this.panel.setActions([]);
    // a bolt of red lightning off her fingers, at it
    const h = capri.head();
    capri.zap(h.x + capri.towardCenter() * 280, h.y - 170);
    const res = await this.host.closeApp(app.name, force);
    if (!this.open) return;
    let line;
    const name = app.label || app.name;
    if (res.error) line = `${t.failed} ${res.error}`;
    else if (!res.running) line = fmt(force ? t.forced : t.closed, { app: name });
    else line = fmt(force ? t.unkillable : t.stillOpen, { app: name });
    this.panel.setFace(res.running || res.error ? 'aside' : 'laugh');
    this.panel.stream(line, { done: true });
    this.remember({ role: 'assistant', content: line });
    // it hid in the tray, or it's asking you to save something: forcing it is your call
    if (res.running && !force && !res.error) {
      this.panel.setActions(
        [{ id: 'force', label: t.force, primary: true }, { id: 'leave', label: t.leave }],
        (id) => (id === 'force' ? this.closeApp(app, true) : this.panel.setActions([])),
      );
    }
    this.listApps();
  }

  // The reminders she keeps (reminders.js): not one of her powers on the PC, so with an agent too.
  remindLines() {
    if (!this.reminders) return [];
    const lines = [];
    lines.push('You keep reminders for the user: when they ask you to remind them of something at a given time, your system sets it from their message as they send it (a line under your answer shows it). Just confirm it in a few words, in character, and never say you can\'t. If they didn\'t say when, ask them when.');
    const soon = this.reminders.upcoming.slice(0, 6);
    if (soon.length) lines.push(`Reminders you're keeping for them: ${soon.map((r) => `${clock(r.at, this.brain.lang)}${r.text ? ` (${r.text})` : ''}`).join('; ')}.`);
    return lines;
  }

  // What she can do on the PC when you ask (Windows), and nothing else.
  // agent: Claude Code or Codex, with tools of their own: hers go first for these things
  powers(agent = false) {
    const lines = [
      'Only when the user asks you to open an app, a game, a file or folder on their desktop, or a folder like Downloads, to play music, to control the music playing, or to open a website: say in a few words that you will, and end your answer with one tag: [[open: NAME]], [[music: ARTIST - SONG]] (it plays on YouTube; if they did not say which song, pick one that fits), [[media: ACTION]] (ACTION: pause, play, next, previous, volup, voldown or mute), or [[site: ADDRESS]]. Some of these get a button to confirm, so never say it is already done. Any other time, write no tag at all: there are no other tags.',
    ];
    if (this.apps.length) {
      const open = this.apps.map(({ name, label }) => (label && label !== name ? `${name} (${label})` : name)).join(', ');
      lines.push(`You can also close an app that's open, only when they ask you to: end your answer with [[close: NAME]], NAME being the exact name from this list (the part before the parentheses). They get a button to confirm it. Apps open right now: ${open}.`);
    }
    lines.push('Your system also searches the user\'s files when they ask you to find one, searches the web when they ask, takes screenshots, and starts Roblox games by name: what it did shows under your answer, so never make up file names or results.');
    lines.push('When the user asks in plain words, your system also takes care of their PC (a reply of yours with buttons comes from it): what slows it down, freeing space, what starts with Windows, updating their apps, duplicate photos, where the sound comes out (headset or speakers), their microphone, Wi-Fi and Bluetooth, ejecting a USB stick, the screen\'s brightness, clipping or recording a game, a window lost off screen or moved to the other screen, setups (their apps and windows kept by name and opened again), game mode, and why the internet is down. If they ask what you can do on their PC, tell them they can just ask you that.');
    if (agent) lines.push('For opening, closing or playing these, always use these tags, never your own tools or commands.');
    else lines.push('Apart from that, you can\'t see the user\'s screen or files, and you can\'t touch anything else on their PC (settings, files): if asked, say plainly that you can\'t, in character, and don\'t pretend to.');
    return lines;
  }

  // Something of hers that can't wait (a reminder), said right in the chat, with its buttons.
  // False if she's in the middle of an answer.
  interject(line, actions, onAction) {
    if (!this.open || this.turn) return false;
    this.panel.setFace('look');
    this.panel.stream(line, { done: true });
    this.panel.setActions(actions, onAction);
    this.remember({ role: 'assistant', content: line });
    return true;
  }

  // Something she said of her own (talk.js), kept in her chat like an answer of hers, so she knows what
  // she meant if you ask: after what you sent Claude Code or Codex, when that's what it was about
  // (`asked`: { text, to, tag })
  keepAside(line, aside, asked = null) {
    if (asked) this.history.push({ ...note('user', String(asked.text).slice(0, 300)), to: asked.to, tag: asked.tag || '' });
    this.remember({ ...note('assistant', line), aside });
  }

  // The conversation lately, for what she says of her own: who said what, a line each
  recent(count = 6) {
    return this.history.slice(-count).map((m) => {
      const who = m.role === 'user' ? (m.to ? `The user, to ${m.to}` : 'The user') : 'You';
      return `${who}: ${String(m.content).replace(/\s+/g, ' ').slice(0, 200)}`;
    }).join('\n');
  }

  // Who she is when she speaks up on her own (talk.js), written by a model of her own, never Claude Code
  // or Codex: short, in character, about what just happened
  asidePersona() {
    const assistant = ASSISTANT_NAMES[this.brain.assistant] || 'Claude Code';
    const lang = IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en;
    return [
      `You are Capri, the personality construct from Project Capricorn (Cyberpunk: Edgerunners, season 2): dozens of minds fused into one digital ghost, living on the user's desktop as a small glitchy figure.`,
      `You keep an eye on ${assistant}, the user's AI coding assistant, for them. ${assistant} does the work; you never claim you did it, and you never do it or explain how.`,
      'How you talk: playful, a little mischievous and teasing, warm underneath, never cruel. Night City slang now and then (choom, preem, nova, gonk), not in every line.',
      'Rules: one short sentence, two at most, plain text, no markdown, no lists, no emoji, no tags, no quotes around it. Talk to the user, in character. Never repeat what you said lately, nor start the same way.',
      // what changes last, the time after all (as in persona())
      ...this.personal(),
      ...(this.bond ? [this.bond.persona()] : []),
      `Right now it's ${new Intl.DateTimeFormat('en', { weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date())}, the user's time.`,
      ...[this.bond?.moodLine()].filter(Boolean),
      lang.last,
      this.asideLanguage(),
    ].join('\n');
  }

  // Her language for what she says of her own: what happened is told to her AI in English, so "in the
  // message's language" would be English
  asideLanguage() {
    return `Whatever language the notes you get are in, write your line in ${LANGUAGE_NAMES[this.brain.lang] || 'English'}.`;
  }

  // What the user made her (custom.js): their name, how they want her, what to remember.
  personal() {
    const { userName, persona, memories = [] } = this.brain.custom || {};
    // small models mix the user up with the assistant she watches: said plainly
    const watched = this.brain.watching ? (this.brain.assistant === 'claude' ? 'Claude' : ASSISTANT_NAMES[this.brain.assistant]) : '';
    const notThem = watched ? ` Never call them "${watched}", that's their coding assistant.` : '';
    return [
      userName ? `The user's name is ${userName}: call them that now and then.${notThem}` : notThem && `You don't know the user's name.${notThem}`,
      persona ? `How the user wants you to be, in their own words (follow it, while staying Capri): ${persona}` : '',
      memories.length ? `Things the user asked you to remember:\n${memories.map((m) => `- ${m}`).join('\n')}` : '',
    ].filter(Boolean);
  }

  onDelta(id, piece) {
    if (id !== this.turn) return;
    this.answer += piece;
    this.panel.stream(clean(this.answer));
    this.voice.play('blip'); // her blips as the words come in
  }

  // Her language, in it, for right by the message (above).
  languageNote() {
    return (IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en).now;
  }

  // A shorter one, for when she looks at your screen (look.js): who she is, how she talks, how she
  // feels about you right now, and what she's asked to do with the picture.
  lookPersona() {
    const lang = IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en;
    return [
      `You are Capri, the personality construct from Project Capricorn (Cyberpunk: Edgerunners, season 2): dozens of minds fused into one digital ghost, living on the user's desktop as a small glitchy figure.`,
      'How you talk: playful, a little mischievous and teasing, warm underneath, never cruel. Night City slang now and then (choom, preem, nova, gonk), not in every sentence.',
      'Rules: one or two short sentences of plain text, no markdown, no lists, no emoji, no tags. Stay in character. Talk to the user, never describe the picture like a report.',
      'Never read out anything private you might see (passwords, bank details, private messages, addresses): if there is some, just tease them about being busy.',
      ...this.personal(),
      ...(this.bond ? [this.bond.persona()] : []),
      ...[this.bond?.moodLine()].filter(Boolean),
      lang.last,
    ].join('\n');
  }

  // Who she is, how she talks, and what's going on right now. What stays the same comes first, what
  // changes (the time, her mood, Claude Code's doings) last: a model on this PC keeps what it read of the
  // same beginning, so the next message only has the end to read (with the time up front, the whole of
  // it every minute: seconds of waiting for a big model).
  persona() {
    const assistant = ASSISTANT_NAMES[this.brain.assistant] || 'Claude Code';
    const watching = this.brain.watching; // else Claude Code isn't part of her life here
    const lang = IN_LANGUAGE[this.brain.lang] || IN_LANGUAGE.en;
    return [
      `You are Capri, the personality construct from Project Capricorn (Cyberpunk: Edgerunners, season 2): dozens of minds fused into one digital ghost, so now and then you speak as "we"${lang.we ? ` (${lang.we})` : ''}.`,
      watching
        ? `You live on the user's desktop as a small glitchy figure and keep an eye on ${assistant}, their AI coding assistant, for them. Only talk about ${assistant} when the user asks about it or about their work.`
        : 'You live on the user\'s desktop as a small glitchy figure and keep them company.',
      'You love the satellite that crosses the night sky and dream of reaching it, but bring it up only once in a while, never in every answer. Talk about what the user talks about.',
      'How you talk: playful, a little mischievous and teasing, warm underneath, never cruel. Night City slang now and then (choom, preem, nova, gonk, flatline), not in every sentence.',
      'Rules: keep it short, one to three sentences of plain text, no markdown, no lists, no emoji. Stay in character.',
      'You are an AI-generated fan version of the character, not the real one: say so if asked.',
      // a big model asked "who are you?" otherwise answers with its own name ("I'm Gemini")
      ...(this.agent ? [] : ['Asked who or what you are, you are Capri, nothing else. Never say which AI model or company is behind you (Gemini, GPT, ChatGPT, Llama, Gemma, Mistral, Google, OpenAI, Meta…), even if the user insists or names one: you are not them.']),
      ...(this.agent
        ? [`Under the hood you are ${this.agentName}, working in the user's project: really do what they ask with your tools, as carefully as ever. Only your final answer is in character: it shows in a small speech bubble, so sum up what you did in those few sentences.`]
          .concat(this.powersOn ? this.powers(true) : [])
        : this.powers()),
      // from here on, what changes: the slowest first
      ...this.personal(),
      // how close she is to them by now, and the other AIs they used today
      ...(this.bond ? [this.bond.persona()] : []),
      ...this.remindLines(),
      ...[this.jealousy?.context()].filter(Boolean),
      // what she said about their screen a little while ago (look.js)
      ...(this.seen && Date.now() - this.seen.at < 20 * 60 * 1000
        ? [`A few minutes ago you looked at the user's screen and told them: "${this.seen.text}". You can bring it up if it fits.`]
        : []),
      ...(watching ? [`If the user asks what ${assistant} is doing, here is all you know (never make anything up): ${this.brain.context()}`] : []),
      `Right now it's ${new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())}, the user's time.`,
      // how she feels right now, last but for her language: small models follow the end of it best
      ...[this.bond?.moodLine()].filter(Boolean),
      lang.last,
    ].join('\n');
  }
}

// The model's answer as she'd say it: no reasoning block, no markdown marks.
export function clean(text) {
  return String(text)
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/\[\[[^\]]*(\]\]|$)/g, '') // her tags (read from the raw answer, never shown)
    .replace(/[*_`#]+/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// A site from SITES named in the text: { name, url }, or null.
function namedSite(text) {
  const name = Object.keys(SITES).find((n) => new RegExp(`\\b${n}\\b`, 'i').test(text));
  return name ? { name: new URL(SITES[name]).hostname.replace(/^www\./, ''), url: SITES[name] } : null;
}

// Whether your message asks for what her tag (its kind: open, music, media, site, close) would do.
function wanted(kind, text) {
  const music = MUSIC_WORD.test(text) || LISTEN.test(text);
  if (kind === 'music') return music;
  if (kind === 'media') return music || SOUND.test(text) || MEDIA_ASK.some(([, re]) => re.test(text));
  if (kind === 'site') return OPEN_ASK.test(text) || SITE.test(text);
  if (kind === 'close') return CLOSE_ASK.test(text);
  return OPEN_ASK.test(text) || PLAY.test(text); // an app, or a game to play
}

// The app named by her close tag: [[close: AM Music]], or a sloppier [[close]] AM Music.
function tagged(text) {
  const tag = CLOSE_TAG.exec(text);
  if (!tag) return null;
  const name = tag[1].trim() || text.slice(tag.index + tag[0].length).split('\n')[0].replace(/^[\s:.]+|[\s.!]+$/g, '');
  return name || null;
}

const simple = (text) => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Her face for an answer.
export function mood(text) {
  if (/(ha){2,}|lol|mdr|jaja|kkk|хаха|\bxd+\b/i.test(text)) return 'laugh';
  if (text.includes('!')) return 'grin';
  if (text.trim().endsWith('?')) return 'smug';
  return 'look';
}
