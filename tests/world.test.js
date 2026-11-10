'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorld, factsOf, feedItems, manifest, libraryFolders, nameScore, sameTitle } = require('../src/main/world');
const { TRAY } = require('../src/main/labels');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'capri-world-')), 'world.json');

test('an article cut into facts: its references left out, the juicy ones first, fair lengths only', () => {
  const text = [
    'Wiedźmin 3: Dziki Gon to fabularna gra akcji stworzona przez studio CD Projekt Red i wydana w 2015 roku.',
    '== Rozgrywka ==',
    'Geralt może tworzyć eliksiry, odwary i oleje po uzbieraniu składników alchemicznych w świecie gry.',
    'Krótko.',
    '== Produkcja ==',
    'Pierwotnie gra miała mieć inną mapę, ale część obszarów została wycięta przed premierą z powodu terminów.',
    '== Przypisy ==',
    'Przypis, który jest wystarczająco długi, żeby przejść filtr długości, ale go nie chcemy wcale tutaj.',
  ].join('\n');
  const facts = factsOf(text);
  assert.equal(facts.length, 3);
  assert.match(facts[0].text, /^Pierwotnie/); // a juicy one first
  assert.equal(facts.find((f) => /eliksiry/.test(f.text)).tip, true); // from the gameplay part: a tip
  assert.ok(!facts.some((f) => /Przypis/.test(f.text)));
});

test('news feeds: RSS and Atom, CDATA and entities, with their dates', () => {
  const rss = `<rss><channel><item><title><![CDATA[GTA 6 &amp; więcej]]></title><link>https://a.pl/1</link>
    <description><p>Opis <b>tu</b> &#8211; dalej</p></description><pubDate>Mon, 10 Nov 2026 08:00:00 GMT</pubDate></item>
    <item><title>Bez linku</title></item></channel></rss>`;
  const items = feedItems(rss);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { title: 'GTA 6 & więcej', link: 'https://a.pl/1', summary: 'Opis tu – dalej', at: Date.parse('Mon, 10 Nov 2026 08:00:00 GMT') });
  const atom = '<feed><entry><title>Atom one</title><link href="https://b.com/x"/><summary>Short</summary><updated>2026-11-10T09:00:00Z</updated></entry></feed>';
  assert.equal(feedItems(atom)[0].link, 'https://b.com/x');
});

test('Steam on this PC: a manifest, its libraries and the games they list, and which name is the game', () => {
  assert.deepEqual(manifest('"AppState"\n{\n\t"appid"\t\t"2739590"\n\t"name"\t\t"Mad Island"\n\t"installdir"\t\t"Mad Island"\n}'),
    { appid: 2739590, name: 'Mad Island', installdir: 'Mad Island' });
  const vdf = '"libraryfolders"\n{\n"0"\n{\n"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n"apps"\n{\n"292030"\t\t"74030326010"\n"431960"\t\t"826555680"\n}\n}\n"1"\n{\n"path"\t\t"D:\\\\SteamLibrary"\n"apps"\n{\n}\n}\n}';
  assert.deepEqual(libraryFolders(vdf), [
    { root: 'C:\\Program Files (x86)\\Steam', apps: [292030, 431960] },
    { root: 'D:\\SteamLibrary', apps: [] },
  ]);
  // the game, not its editor
  assert.ok(nameScore('The Witcher 3', 'The Witcher 3: Wild Hunt') > nameScore('The Witcher 3', 'The Witcher 3 REDkit'));
  assert.ok(nameScore('RESIDENT EVIL 4 BIOHAZARD RE4', 'Resident Evil 4') >= 1.2);
  // its article, not another game's or an expansion's
  assert.equal(sameTitle('Mad Island', 'Dead Island'), false);
  assert.equal(sameTitle('The Witcher 3: Wild Hunt', 'The Witcher 3: Wild Hunt – Songs of the Past'), false);
  assert.equal(sameTitle('Wiedźmin 3: Dziki Gon – Remaster', 'Wiedźmin 3: Dziki Gon'), true);
  assert.equal(sameTitle('Resident Evil 4', 'Resident Evil 4 (gra komputerowa 2023)'), true);
});

// A fake internet: what each source answers
function fakeFetch(routes, calls = []) {
  return async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, json: async () => null, text: async () => '' };
    const body = typeof hit[1] === 'function' ? hit[1](url) : hit[1];
    return { ok: true, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}

test('a game: found on Steam, its article, its facts told one at a time, and not again before a week', async () => {
  let clock = Date.parse('2026-11-10T12:00:00Z');
  const calls = [];
  const fetch = fakeFetch({
    storesearch: { items: [{ id: 1, name: 'Mad Island' }, { id: 2, name: 'Mad Island Soundtrack' }] },
    'appdetails?appids=1': { 1: { success: true, data: { name: 'Mad Island', type: 'game', short_description: 'Escape the island, or don\'t: it is a survival game with crafting.', genres: [{ description: 'RPG' }], release_date: { date: '2025' } } } },
    'list=search': { query: { search: [{ title: 'Dead Island' }] } }, // no article of its own
  }, calls);
  const w = createWorld({ file: tmp(), fetch, now: () => clock, steamRoots: [] });
  const g = await w.game('Mad Island', 'en');
  assert.equal(g.appid, 1);
  assert.equal(g.source, null); // Dead Island's isn't its article
  assert.equal(g.facts.length, 1);
  const f = await w.gameFact('Mad Island', 'en');
  assert.match(f.fact, /survival game/);
  assert.equal(await w.gameFact('Mad Island', 'en'), null); // all told: not again today
  clock += 8 * 24 * 3600 * 1000;
  assert.ok(await w.gameFact('Mad Island', 'en')); // a week later
  // asked once: kept
  const before = calls.length;
  await w.game('Mad Island', 'en');
  assert.equal(calls.length, before);
});

test('headlines: the freshest she hasn\'t told you; the day: weather, name days, holidays', async () => {
  const xml = (n) => `<rss><channel>${[1, 2].map((i) => `<item><title>Nr ${n}${i}</title><link>https://n.pl/${n}${i}</link><pubDate>${new Date(Date.parse('2026-11-10T0' + i + ':00:00Z')).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
  const fetch = fakeFetch({
    'feed-a': xml('a'),
    'geocoding-api': { results: [{ name: 'Kraków', latitude: 50, longitude: 19.9, country_code: 'PL' }] },
    'api.open-meteo.com': { current: { temperature_2m: 0.9, weather_code: 3 }, daily: { temperature_2m_min: [-1.7], temperature_2m_max: [4.4], precipitation_probability_max: [97], weather_code: [61] } },
    'nameday.abalin.net': { data: { pl: 'Andrzej, Leon' } },
    'date.nager.at': [{ date: '2026-11-11', localName: 'Narodowe Święto Niepodległości', name: 'National Independence Day' }],
  });
  const w = createWorld({ file: tmp(), fetch, now: () => Date.parse('2026-11-10T12:00:00'), steamRoots: [] });
  assert.equal((await w.headline(['https://x/feed-a'])).title, 'Nr a2');
  assert.equal((await w.headline(['https://x/feed-a'])).title, 'Nr a1');
  assert.equal(await w.headline(['https://x/feed-a']), null);
  const day = await w.today('Kraków', 'pl');
  assert.deepEqual(day.weather, { place: 'Kraków', now: 1, sky: 'overcast', code: 3, min: -2, max: 4, rain: 97, day: 'light rain', dayCode: 61 });
  assert.equal(day.nameday, 'Andrzej, Leon');
  assert.equal(day.holiday, null);
  assert.equal(day.tomorrow, 'Narodowe Święto Niepodległości');
});

test('releases: only games like the ones you play, each once', async () => {
  const fetch = fakeFetch({
    featuredcategories: { coming_soon: { items: [{ id: 10 }, { id: 11 }] }, new_releases: { items: [{ id: 12 }] } },
    'appids=10': { 10: { success: true, data: { name: 'Farm Days', type: 'game', genres: [{ description: 'Simulation' }], release_date: { date: '12 Nov 2026', coming_soon: true } } } },
    'appids=11': { 11: { success: true, data: { name: 'Blood Hunt', type: 'game', genres: [{ description: 'Action' }, { description: 'RPG' }], release_date: { date: '14 Nov 2026', coming_soon: true } } } },
    'appids=12': { 12: { success: true, data: { name: 'Some DLC', type: 'dlc', genres: [{ description: 'RPG' }] } } },
    'appids=5': { 5: { success: true, data: { name: 'The Witcher 3', type: 'game', short_description: 'A story-driven open world RPG set in a fantasy universe, with a monster hunter.', genres: [{ description: 'RPG' }], release_date: { date: '2015' } } } },
    storesearch: { items: [{ id: 5, name: 'The Witcher 3' }] },
  });
  const w = createWorld({ file: tmp(), fetch, now: () => Date.now(), steamRoots: [] });
  await w.game('The Witcher 3', 'en');
  const r = await w.release('en');
  assert.equal(r.name, 'Blood Hunt');
  assert.deepEqual(r.like, ['The Witcher 3']);
  assert.equal(await w.release('en'), null); // Farm Days isn't your kind, the DLC is no game
});

// her renderer's modules, in Node (util.js asks the screen whether motion is reduced)
const renderer = async () => {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });
  const [world, lines] = await Promise.all([import('../src/renderer/js/world.js'), import('../src/renderer/js/lines.js')]);
  return { ...world, LINES: lines.LINES };
};

test('her telling of a game\'s fact kept its names or numbers (Polish declines them), else the fact itself', async () => {
  const { keeps } = await renderer();
  const fact = 'Na konsolę GameCube sprzedano 1,69 mln kopii, a na Wii 1,56 mln sztuk.';
  assert.equal(keeps(fact, 'Wiesz, że na GameCube poszło 1,69 miliona kopii?'), true);
  assert.equal(keeps(fact, 'Ta gra sprzedała się świetnie, choom.'), false);
  assert.equal(keeps('W świecie Wiedźmina Geralt może tworzyć eliksiry.', 'Geralta stać na eliksiry.'), true); // "Geralta"
  assert.equal(keeps('a fact with no names at all, only words.', 'anything'), true);
});

test('her line without the facts shown under it, when her model reads them out anyway', async () => {
  const { withoutEcho } = await import('../src/renderer/js/talk.js');
  const under = 'Kraków: teraz 1°C, pochmurno. Dziś od -2 do 4°C, słaby deszcz.';
  assert.equal(withoutEcho('Spacery pod deszczem to dobry sposób na rozgrzanie się, co? Kraków: teraz 1°C, pochmurno. Dziś od -2', under),
    'Spacery pod deszczem to dobry sposób na rozgrzanie się, co?');
  assert.equal(withoutEcho('Kraków: teraz 1°C, pochmurno. Dziś od -2 do 4°C', under), null); // nothing of her own left
  assert.equal(withoutEcho('Parasol, choom. Dziś pada.', under), 'Parasol, choom. Dziś pada.');
});

test('the facts under her line, in her language: the weather, name days, holidays, a headline, a release', async () => {
  const { World, LINES } = await renderer();
  const w = new World({ host: {}, talk: {}, brain: { t: LINES.pl }, store: null });
  assert.equal(w.under('day', {
    weather: { place: 'Kraków', now: 1, code: 3, min: -2, max: 4, dayCode: 63, rain: 97 }, nameday: 'Andrzej, Leon', tomorrow: 'Narodowe Święto Niepodległości',
  }), 'Kraków: teraz 1°C, pochmurno. Dziś od -2 do 4°C, deszcz. Szansa na deszcz: 97%. Imieniny: Andrzej, Leon. Jutro: Narodowe Święto Niepodległości.');
  assert.equal(w.sky(55), 'mżawka'); // drizzle's group
  assert.equal(w.under('news', { title: 'GTA 7 szybciej?', source: 'GRYOnline.pl' }), '„GTA 7 szybciej?” (GRYOnline.pl)');
  assert.equal(w.under('release', { name: 'System Arrival', soon: true, date: '10 listopada 2026', genres: ['Akcja', 'RPG', 'Indie', 'X'] }),
    'System Arrival: 10 listopada 2026 na Steamie (Akcja, RPG, Indie).');
  // what talk.js gets: the facts under her line, her usual line if her model has none
  const s = w.saying('news', { title: 'T', source: 'S' });
  assert.equal(s.under, '„T” (S)');
  assert.ok(LINES.pl.world.open.news.includes(s.fallback));
});

test('her moments: a game\'s fact only after long enough, so many a day; the day\'s greeting before the news', async () => {
  const { World, FREQ, LINES } = await renderer();
  let clock = new Date('2026-11-10T09:00:00').getTime();
  const said = [];
  const talk = { may: () => true, line: async (kind, d, asked, opts) => { said.push([kind, d, opts]); return `${kind}!`; } };
  const host = {
    worldGame: async (folder, fact) => (fact ? { game: folder, fact: 'A fact.', tip: false } : null),
    worldToday: async () => ({ nameday: 'Andrzej' }),
    worldNews: async () => ({ title: 'Headline', source: 'X' }),
    worldRelease: async () => null,
  };
  const store = new Map();
  const w = new World({ host, talk, brain: { t: LINES.en }, now: () => clock, store: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } });
  w.configure({ worldTalk: 'rare', gameFacts: true, news: true, dayInfo: true, releases: true });
  assert.equal(await w.afterGame('Witcher', 10 * 60 * 1000), null); // 10 minutes: not long enough when rare
  assert.equal(await w.afterGame('Witcher', 50 * 60 * 1000), 'game!');
  assert.equal(await w.afterGame('Witcher', 50 * 60 * 1000), null); // one a day when rare
  assert.equal(await w.tick(), 'day!');
  assert.equal(await w.tick(), 'news!'); // nothing to release: the news
  assert.equal(await w.tick(), null); // one headline a day when rare
  clock += 24 * 3600 * 1000;
  assert.equal(await w.tick(), 'day!'); // a new day
  assert.equal(FREQ.often.gamePerDay > FREQ.rare.gamePerDay, true);
  // turned off: nothing at all
  w.configure({ worldTalk: 'often' });
  assert.equal(await w.afterGame('Witcher', 3 * 3600 * 1000), null);
  assert.equal(await w.tick(), null);
});

test('Mainframe\'s WORLD in both languages', () => {
  const keys = ['secWorld', 'worldTalk', 'worldRare', 'worldNormal', 'worldOften', 'worldTip', 'gameFacts', 'releasesOn', 'newsOn', 'newsUrl', 'newsAdd', 'dayInfo', 'cityLabel', 'citySave', 'cityFound', 'cityUnknown', 'cityNone'];
  for (const lang of ['en', 'pl']) for (const k of keys) assert.ok(TRAY[lang][k], `${lang}.${k}`);
});
