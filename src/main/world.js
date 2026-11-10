'use strict';

// Her world past your desktop, for what she says of her own (the overlay's world.js decides when, talk.js has
// her model put it in her words): what she knows of the game you play (its Steam page and its Wikipedia
// article, cut into facts she tells you one at a time, never made up), games coming out on Steam like the
// ones you play, a headline from the news feeds you picked, and the day (the weather where you live, whose
// name day it is, a public holiday). Each source is switched on in Mainframe › RELIC › WORLD; what goes out
// is a game's name, your city's name and the feeds' addresses, never anything of your screen. All of it is
// kept in world.json, so she asks each source once (a game's facts for a month, the day once a day).

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const UA = 'Capri-desktop (a desktop companion; github.com/nf-gh057/capri-desktop)';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const GAME_KEEP = 30 * DAY;  // a game's facts, fetched again after this
const SOON_KEEP = 12 * HOUR; // Steam's coming soon list
const FEED_KEEP = HOUR;      // a news feed
const SEEN_KEEP = 400;       // headlines and releases she told you of, remembered

// The news feeds offered in Mainframe (you can add your own): their name, their address
const FEEDS = [
  { url: 'https://www.gry-online.pl/rss/news.xml', label: 'GRYOnline.pl', lang: 'pl' },
  { url: 'https://cdaction.pl/feed', label: 'CD-Action', lang: 'pl' },
  { url: 'https://www.eurogamer.pl/feed', label: 'Eurogamer.pl', lang: 'pl' },
  { url: 'https://www.benchmark.pl/rss/aktualnosci-pliki.xml', label: 'Benchmark.pl', lang: 'pl' },
  { url: 'https://www.pcgamer.com/rss/', label: 'PC Gamer', lang: 'en' },
  { url: 'https://www.rockpapershotgun.com/feed', label: 'Rock Paper Shotgun', lang: 'en' },
];

// --- Reading what comes back (plain functions, tested) ---------------------------------------------------

// The parts of an article worth telling: not its references, links or lists of names
const SKIP_SECTION = /^(?:przypisy|zobacz też|linki zewnętrzne|bibliografia|uwagi|obsada|references|see also|external links|notes|further reading|bibliography|cast|footnotes)$/i;
const TIP_SECTION = /rozgrywk|gameplay|mechani|system walki|combat/i;
// what makes a fact worth more than another: a secret, a record, how it was made, what it took from
const JUICY = /sekret|ukryt|easter|nawiązan|inspir|pierwotn|wycięt|usunięt|rekord|sprzeda|nagrod|ciekaw|zainspirowa|secret|hidden|reference|inspired|originally|cut |removed|record|sold|award|reportedly|initially/i;

// An article (MediaWiki plain text) cut into facts: { text, tip } sentences of a fair length, the juicy ones
// first, at most `max`
function factsOf(text, max = 40) {
  const out = [];
  const parts = String(text || '').split(/^==+\s*(.+?)\s*==+\s*$/m);
  // parts: intro, then [heading, body] pairs
  for (let i = 0; i < parts.length; i += 2) {
    const heading = i === 0 ? '' : parts[i - 1];
    if (SKIP_SECTION.test(heading.trim())) continue;
    const tip = TIP_SECTION.test(heading);
    const sentences = parts[i].replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ0-9„"“])/u);
    for (const s of sentences) {
      const t = s.trim();
      if (t.length < 50 || t.length > 300 || /[{}|=]|\s–\s.*\s–\s/.test(t)) continue;
      out.push({ text: t, tip, juicy: JUICY.test(t) });
    }
  }
  // the juicy ones first, then the rest as the article tells them
  return [...out.filter((f) => f.juicy), ...out.filter((f) => !f.juicy)].slice(0, max).map(({ text, tip }) => ({ text, tip }));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    : ENTITIES[e.toLowerCase()] ?? m))
  .replace(/\s+/g, ' ')
  .trim();

// An RSS or Atom feed's items: { title, link, summary, at }
function feedItems(xml) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/g)) {
    const block = m[0];
    const tag = (name) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block)?.[1] || '';
    const title = decode(tag('title'));
    const link = decode(tag('link')) || /<link[^>]*href="([^"]+)"/.exec(block)?.[1] || '';
    const summary = decode(tag('description') || tag('summary') || tag('content')).slice(0, 300);
    const when = Date.parse(decode(tag('pubDate') || tag('published') || tag('updated') || tag('dc:date')));
    if (title && link) items.push({ title, link, summary, at: Number.isFinite(when) ? when : 0 });
  }
  return items;
}

// A Steam library's manifests: the game in each folder ({ appid, name, installdir })
function manifest(text) {
  const field = (k) => new RegExp(`"${k}"\\s+"([^"]*)"`).exec(text)?.[1];
  const appid = Number(field('appid'));
  return appid ? { appid, name: field('name') || '', installdir: field('installdir') || '' } : null;
}

// Open-Meteo's weather codes, in words for her model
const WEATHER = [
  [0, 'clear sky'], [1, 'mostly clear'], [2, 'partly cloudy'], [3, 'overcast'], [45, 'fog'], [48, 'icy fog'],
  [51, 'light drizzle'], [53, 'drizzle'], [55, 'heavy drizzle'], [56, 'freezing drizzle'], [57, 'freezing drizzle'],
  [61, 'light rain'], [63, 'rain'], [65, 'heavy rain'], [66, 'freezing rain'], [67, 'freezing rain'],
  [71, 'light snow'], [73, 'snow'], [75, 'heavy snow'], [77, 'snow grains'], [80, 'rain showers'], [81, 'rain showers'],
  [82, 'violent rain showers'], [85, 'snow showers'], [86, 'heavy snow showers'], [95, 'thunderstorm'],
  [96, 'thunderstorm with hail'], [99, 'thunderstorm with hail'],
];
const weatherWords = (code) => WEATHER.find(([c]) => c === code)?.[1] || 'unsettled weather';

// a name as a key: lower case, letters and digits ("RESIDENT EVIL 4  BIOHAZARD RE4" -> "residentevil4biohazardre4")
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
// how much two names share (Steam's search answers with DLCs and soundtracks too)
const like = (a, b) => {
  const wa = words(a);
  const wb = new Set(words(b));
  return wa.length ? wa.filter((w) => wb.has(w)).length / wa.length : 0;
};

// Steam's libraryfolders.vdf: each library's folder and the games Steam says it holds
function libraryFolders(vdf) {
  const out = [];
  for (const m of String(vdf || '').matchAll(/"path"\s+"([^"]+)"([\s\S]*?)(?="path"|$)/g)) {
    const apps = /"apps"\s*\{([^}]*)\}/.exec(m[2])?.[1] || '';
    out.push({ root: m[1].replace(/\\\\/g, '\\'), apps: [...apps.matchAll(/"(\d+)"\s+"\d+"/g)].map((a) => Number(a[1])) });
  }
  return out;
}

// not the game itself: its editor, server, soundtrack, demo or a pack of it
const TOOLISH = /\b(?:redkit|sdk|editor|dedicated server|server|soundtrack|ost|demo|tool|wallpaper|artbook|pack|dlc|season pass|upgrade)\b/i;
// how well a store's name fits the folder's: its words in the folder's, and the folder's in its (2 is all)
const nameScore = (folder, name) => like(folder, name) + like(name, folder) - (TOOLISH.test(name) ? 1 : 0);
// a Wikipedia title for the game: its words all there and not much more ("Dead Island" isn't "Mad Island"),
// what's in brackets left out ("Wiedźmin 3: Dziki Gon – Remaster", "Resident Evil 4 (gra komputerowa z 2023)")
// (a store's name loses its " – Remaster"; a title keeps what follows a dash: "… – Songs of the Past" is another)
const bare = (s) => String(s || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+[–—-]\s+.*$/, '').trim();
const bareTitle = (s) => String(s || '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
const sameTitle = (name, title) => like(bare(name), bareTitle(title)) >= 0.75 && like(bareTitle(title), bare(name)) >= 0.75;

// a day as its date here (not UTC's): 2026-11-10
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// --- The sources ---------------------------------------------------------------------------------------------

function createWorld({ file, fetch = globalThis.fetch, now = Date.now, steamRoots = null, log = () => {} }) {
  let state = { games: {}, soon: null, feeds: {}, seen: [], day: null, geo: null, holidays: {} };
  try {
    state = { ...state, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // nothing kept yet
  }
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(state));
      } catch (err) {
        log(`[world] could not save: ${err.message}`);
      }
    }, 1000);
  };

  async function get(url, kind = 'json') {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: kind === 'json' ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      return kind === 'json' ? await res.json() : await res.text();
    } catch (err) {
      log(`[world] ${new URL(url).host}: ${err.message}`);
      return null;
    }
  }

  // Steam's libraries on this PC (its own folder, from the registry, and the ones it lists), with the games
  // Steam says each holds: { root, apps: [appid] }
  let roots = steamRoots;
  async function libraries() {
    if (roots) return roots;
    const steam = await new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve(null);
      execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, out) => {
        resolve(err ? null : /SteamPath\s+REG_SZ\s+(.+)/.exec(out)?.[1]?.trim() || null);
      });
    });
    roots = [];
    if (steam) {
      try {
        roots = libraryFolders(fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
      } catch { /* the one folder only */ }
      if (!roots.some((r) => path.normalize(r.root) === path.normalize(steam))) roots.unshift({ root: steam, apps: [] });
    }
    return roots;
  }

  // a game's name on Steam, by its number (kept: asked once)
  async function appName(appid) {
    state.names = state.names || {};
    if (!(appid in state.names)) {
      const d = await details(appid, 'en');
      state.names[appid] = d && d.type === 'game' ? d.name : null;
      save();
    }
    return state.names[appid];
  }

  // The game in a folder (as windows.ps1 names it): Steam's manifest for it; else, among the games Steam
  // lists in its libraries without one (moved, or installed by hand), the one named like it; else the store's
  // search, its tools, DLCs and soundtracks left out
  async function findApp(folder) {
    const libs = await libraries();
    const manifested = new Set();
    for (const { root } of libs) {
      const apps = path.join(root, 'steamapps');
      let names = [];
      try {
        names = fs.readdirSync(apps).filter((n) => /^appmanifest_\d+\.acf$/.test(n));
      } catch { continue; }
      for (const n of names) {
        let m = null;
        try {
          m = manifest(fs.readFileSync(path.join(apps, n), 'utf8'));
        } catch { /* unreadable */ }
        if (!m) continue;
        manifested.add(m.appid);
        if (slug(m.installdir) === slug(folder)) return { appid: m.appid, name: m.name };
      }
    }
    const term = folder.replace(/\s+/g, ' ').trim();
    const listed = [...new Set(libs.flatMap((l) => l.apps))].filter((id) => !manifested.has(id)).slice(0, 30);
    let best = null;
    for (const appid of listed) {
      const name = await appName(appid);
      const score = name ? nameScore(term, name) : 0;
      if (score > (best?.score || 0)) best = { appid, name, score };
    }
    if (best && best.score >= 1.2) return { appid: best.appid, name: best.name };
    // the store's search, the folder's name shortened if nothing comes ("RESIDENT EVIL 4  BIOHAZARD RE4")
    const all = term.split(' ');
    for (const n of [all.length, 3, 2].filter((k, i, a) => k <= all.length && a.indexOf(k) === i)) {
      const found = await get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(all.slice(0, n).join(' '))}&l=english&cc=US`);
      const hits = (found?.items || []).filter((i) => !TOOLISH.test(i.name))
        .map((i) => ({ appid: i.id, name: i.name, score: nameScore(term, i.name) }))
        .sort((a, b) => b.score - a.score);
      if (hits[0]?.score >= 1.2) return { appid: hits[0].appid, name: hits[0].name };
    }
    return null;
  }

  async function details(appid, lang) {
    const l = lang === 'pl' ? 'polish' : 'english';
    const r = await get(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=${l}&cc=${lang === 'pl' ? 'pl' : 'us'}`);
    const d = r?.[appid]?.success ? r[appid].data : null;
    if (!d) return null;
    return {
      name: d.name,
      short: decode(d.short_description),
      genres: (d.genres || []).map((g) => g.description),
      date: d.release_date?.date || '',
      soon: Boolean(d.release_date?.coming_soon),
      type: d.type,
    };
  }

  // Its Wikipedia article, in her language if there's one, else the English one. `year`: the game's (a remake
  // shares its name with the original: the article with its year wins)
  // `names`: the game's names to look for, in her language's first (Steam's, then its English one)
  async function article(names, lang, year = '') {
    for (const wl of lang === 'en' ? ['en'] : [lang, 'en']) {
      for (const name of names.filter(Boolean)) {
        const what = wl === 'pl' ? 'gra komputerowa' : 'video game';
        const s = await get(`https://${wl}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`${bare(name)} ${what}`)}&srlimit=8&format=json`);
        // the closest titles first (an expansion's article is the game's name and more)
        const hits = (s?.query?.search || []).filter((h) => sameTitle(name, h.title))
          .sort((a, b) => like(bareTitle(b.title), bare(name)) - like(bareTitle(a.title), bare(name)));
        const hit = (year && hits.find((h) => h.title.includes(year))) || hits[0];
        if (!hit) continue;
        const p = await get(`https://${wl}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(hit.title)}`);
        const page = p && Object.values(p.query?.pages || {})[0];
        if (page?.extract) return { title: page.title, text: page.extract, lang: wl };
      }
    }
    return null;
  }

  // What she knows of the game in `folder`: fetched once (a month), kept
  async function game(folder, lang) {
    const key = slug(folder);
    const known = state.games[key];
    if (known && known.lang === lang && now() - known.at < GAME_KEEP) return known;
    const app = await findApp(folder);
    const d = app && (await details(app.appid, lang));
    const name = d?.name || app?.name || folder.replace(/\s+/g, ' ').trim();
    const year = /\b(19|20)\d\d\b/.exec(d?.date || '')?.[0] || '';
    const wiki = await article([...new Set([d?.name, app?.name, name])], lang, year);
    const facts = [
      ...(d?.short ? [{ text: d.short, tip: false }] : []),
      ...factsOf(wiki?.text),
    ];
    if (!facts.length && known) return known;
    state.games[key] = {
      name, appid: app?.appid || null, genres: d?.genres || [], lang, at: now(),
      source: wiki ? `${wiki.lang}.wikipedia.org/wiki/${wiki.title}` : null, facts, used: known?.used?.filter((u) => u < facts.length) || [],
    };
    save();
    return state.games[key];
  }

  // The next fact of hers about the game in `folder` she hasn't told you: { game, fact, tip, genres } or null
  async function gameFact(folder, lang) {
    const g = await game(folder, lang);
    if (!g?.facts.length) return null;
    // all told: round again, but not before a week (a game with two facts isn't told them every evening)
    if (g.used.length >= g.facts.length) {
      if (now() - (g.round || 0) < 7 * DAY) return null;
      g.used = [];
    }
    if (!g.used.length) g.round = now();
    const left = g.facts.map((_, i) => i).filter((i) => !g.used.includes(i));
    // the juicy ones lead the list: mostly those, now and then another
    const i = Math.random() < 0.7 ? left[0] : left[Math.floor(Math.random() * left.length)];
    g.used.push(i);
    save();
    return { game: g.name, fact: g.facts[i].text, tip: g.facts[i].tip, genres: g.genres };
  }

  // The genres of the games you've played lately (what she knows of them), most played first
  function yourGenres() {
    const count = {};
    for (const g of Object.values(state.games)) for (const genre of g.genres || []) count[genre] = (count[genre] || 0) + 1;
    return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([genre]) => genre);
  }

  const seen = (id) => state.seen.includes(id);
  const mark = (id) => {
    state.seen = [...state.seen.filter((s) => s !== id), id].slice(-SEEN_KEEP);
    save();
  };

  // A game coming out on Steam soon, like the ones you play if she knows any: { name, date, genres, like, url }
  async function release(lang) {
    if (!state.soon || state.soon.lang !== lang || now() - state.soon.at > SOON_KEEP) {
      const f = await get(`https://store.steampowered.com/api/featuredcategories?cc=${lang === 'pl' ? 'pl' : 'us'}&l=${lang === 'pl' ? 'polish' : 'english'}`);
      const ids = [...(f?.coming_soon?.items || []), ...(f?.new_releases?.items || [])].map((i) => i.id).filter((id, k, all) => all.indexOf(id) === k).slice(0, 16);
      const list = [];
      for (const id of ids) {
        const d = await details(id, lang);
        if (d && d.type === 'game') list.push({ id, name: d.name, date: d.date, soon: d.soon, genres: d.genres });
      }
      if (list.length) state.soon = { at: now(), lang, list };
      save();
    }
    const mine = yourGenres();
    const fresh = (state.soon?.list || []).filter((r) => !seen(`steam:${r.id}`));
    const scored = fresh.map((r) => ({ ...r, like: r.genres.filter((g) => mine.includes(g)) }))
      .filter((r) => !mine.length || r.like.length)
      .sort((a, b) => b.like.length - a.like.length);
    const r = scored[0];
    if (!r) return null;
    mark(`steam:${r.id}`);
    const played = Object.values(state.games).filter((g) => (g.genres || []).some((x) => r.like.includes(x))).map((g) => g.name).slice(0, 2);
    return { name: r.name, date: r.date, soon: r.soon, genres: r.genres, like: played, url: `https://store.steampowered.com/app/${r.id}` };
  }

  // The freshest headline from your feeds she hasn't told you: { title, summary, source, link }
  async function headline(urls) {
    const all = [];
    for (const url of urls || []) {
      let f = state.feeds[url];
      if (!f || now() - f.at > FEED_KEEP) {
        const xml = await get(url, 'text');
        if (xml) f = state.feeds[url] = { at: now(), items: feedItems(xml).slice(0, 30) };
      }
      const label = FEEDS.find((x) => x.url === url)?.label || new URL(url).host.replace(/^www\./, '');
      for (const item of f?.items || []) all.push({ ...item, source: label });
    }
    const day = now() - 2 * DAY;
    const pick = all.filter((i) => !seen(i.link) && (!i.at || i.at > day)).sort((a, b) => b.at - a.at)[0];
    if (!pick) return null;
    mark(pick.link);
    return { title: pick.title, summary: pick.summary, source: pick.source, link: pick.link };
  }

  // Where you live, for the weather: { name, lat, lon, country } (Open-Meteo's geocoding), kept
  async function place(city, lang) {
    if (!city) return null;
    if (state.geo?.city === city) return state.geo;
    const r = await get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=${lang === 'pl' ? 'pl' : 'en'}`);
    const hit = r?.results?.[0];
    if (!hit) return null;
    state.geo = { city, name: hit.name, lat: hit.latitude, lon: hit.longitude, country: hit.country_code || 'PL' };
    save();
    return state.geo;
  }

  // Today, once a day: { date, weather, nameday, holiday, tomorrow } (each null if unknown or off)
  async function today(city, lang, { weather = true } = {}) {
    const d = new Date(now());
    const date = ymd(d);
    if (state.day?.date === date && state.day.city === (city || '') && state.day.lang === lang) return state.day;
    const geo = weather ? await place(city, lang) : null;
    let w = null;
    if (geo) {
      const r = await get(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=1`);
      if (r?.current) {
        w = {
          place: geo.name, now: Math.round(r.current.temperature_2m), sky: weatherWords(r.current.weather_code), code: r.current.weather_code,
          min: Math.round(r.daily?.temperature_2m_min?.[0]), max: Math.round(r.daily?.temperature_2m_max?.[0]),
          rain: r.daily?.precipitation_probability_max?.[0] ?? null, day: weatherWords(r.daily?.weather_code?.[0]), dayCode: r.daily?.weather_code?.[0] ?? null,
        };
      }
    }
    const country = (geo?.country || (lang === 'pl' ? 'PL' : 'US')).toUpperCase();
    // name days: a Polish custom (and some other countries'), the abalin.net calendar
    let nameday = null;
    if (lang === 'pl' || country === 'PL') {
      const r = await get(`https://nameday.abalin.net/api/V2/date?day=${d.getDate()}&month=${d.getMonth() + 1}`);
      const names = r?.data?.pl;
      if (names && names !== 'n/a') nameday = names;
    }
    const year = d.getFullYear();
    const hkey = `${country}:${year}`;
    if (!state.holidays[hkey]) {
      const r = await get(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`);
      if (Array.isArray(r)) state.holidays[hkey] = r.map((h) => ({ date: h.date, name: lang === 'pl' || country === 'PL' ? h.localName : h.name }));
    }
    const tomorrowDate = ymd(new Date(d.getTime() + DAY));
    const hol = state.holidays[hkey] || [];
    state.day = {
      date, city: city || '', lang, weather: w, nameday,
      holiday: hol.find((h) => h.date === date)?.name || null,
      tomorrow: hol.find((h) => h.date === tomorrowDate)?.name || null,
    };
    save();
    return state.day;
  }

  // Whether a city can be found, for Mainframe (its name as Open-Meteo knows it, or null)
  async function checkCity(city, lang) {
    const geo = await place(city, lang);
    return geo ? `${geo.name} (${geo.country})` : null;
  }

  return {
    game, gameFact, release, headline, today, checkCity,
    flush() {
      clearTimeout(saveTimer);
      try {
        fs.writeFileSync(file, JSON.stringify(state));
      } catch { /* kept in memory only */ }
    },
  };
}

module.exports = { createWorld, factsOf, feedItems, manifest, libraryFolders, nameScore, sameTitle, bare, weatherWords, FEEDS, slug, like };
