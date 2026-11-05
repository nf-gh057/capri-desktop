'use strict';

// Her jealousy past the names she knows (windows.ps1's list): the title of the window in front, a tab
// in your browser or an app, goes to a model on this PC, which says whether it's another AI (its chat,
// its app, a page to download it) and which, then whether it knows that name as an AI's (a small model
// takes nearly every name for one: she closed e-registers, password managers and friends' chats). Pages
// of sites of everything else (YouTube, a messenger, a shop) aren't asked about. The title goes nowhere else: never to an AI online
// (main.js only asks a local model), never to her overlay, never written down; what's kept is a hash
// of it with the answer, so she doesn't ask about the same title twice.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DWELL_MS = 2000;     // in front this long before she asks (not every tab you flick past)
const GAP_MS = 1500;       // between two questions
const BACKOFF_MS = 60000;  // no model to ask, or it failed: not again before this (twice as long each time after)
const BACKOFF_MAX = 30 * 60000;
const SLOW_MS = 15000;     // an answer that took longer: the model doesn't fit this PC right now (a big one off the
                           // graphics card, the card full): she leaves it be a while, her list alone meanwhile
const KEEP = 3000;         // answers kept, the oldest forgotten first
const SAVE_MS = 5000;
const VERSION = 2;         // of the answers kept: 2 since the second question

// What the model answers: JSON in this shape (Ollama's structured outputs). A kind to pick rather than
// a yes or no: a small model says yes to nearly anything, and tells these apart far better.
const KINDS = ['ai_chat', 'ai_download', 'about_ai', 'not_ai'];
const SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: KINDS },
    name: { type: 'string' },
  },
  required: ['kind', 'name'],
};

// The browsers' own names at the end of their titles ("Poe - Google Chrome", "Pi — Mozilla Firefox"):
// left out, so a title is the page's, the same in each.
const BROWSER_TAIL = /\s[-\u2013\u2014|]\s(?:Google Chrome|Microsoft\u200b? Edge|Mozilla Firefox|Firefox|Brave|Opera|Vivaldi|Arc|Chromium|LibreWolf|Waterfox|Floorp|Zen Browser|Zen|Thorium)\s*$/i;

// Edge, with several tabs: "Poe and 3 more pages", in your language ("et 3 autres pages", "i 3 inne strony")
// (before its profile's name, if one: "Pi and 3 more pages - Work")
const EDGE_MORE = /\s+(?:and|et|y|e|i|и|und)(?:\s+\p{L}{1,8})?\s+\d+(?:\s+\p{L}+){1,2}(?=$|\s[-–—]\s[^-–—]*$)/u;

// A search engine's results ("poe ai - Google Search"): about an AI at most, never one. Not asked about
// (a small model takes them for the AI searched for).
const SEARCH = /\s[-\u2013\u2014|]\s(?:Google Search|Recherche Google|Buscar con Google|Pesquisa Google|Поиск в Google|Szukaj w Google|Google Suche|Cerca con Google|Bing|DuckDuckGo|Yandex|Яндекс|Ecosia|Brave Search|Startpage|Qwant|Kagi Search)$/i;

// A page on a site of everything else (a video, a post, a wiki, a repo, a shop, a friend in a messenger):
// at most about an AI, never its own page. Not asked about either.
const ELSEWHERE = /\s[-\u2013\u2014|\u00b7\u2022]\s(?:YouTube|Reddit|Wikipedia|Wikip\u00e9dia|Wikipedia, wolna encyklopedia|\u0412\u0438\u043a\u0438\u043f\u0435\u0434\u0438\u044f|Fandom|GitHub|GitLab|Hugging Face|Stack Overflow|Medium|Substack|X|Twitter|Facebook|Messenger|WhatsApp|Instagram|TikTok|LinkedIn|Discord|Twitch|Telegram|Spotify|Netflix|Steam|Amazon(?:\.\w+)*|Allegro(?:\.pl)?|Google Play|App Store|Microsoft Store|Product Hunt|IMDb|Gmail|Outlook)(?:\s.*)?$/i;
// GitHub's own way: "owner/repo: what it is"
const REPO = /^[\w.-]+\/[\w.-]+: /;

// Her own windows and the PC's, by name: she's no rival of herself.
const SELF = /^capri/;

// A title as she asks about it: no unread count in front ("(3) Inbox"), no unsaved mark, no browser.
// '' for one not to ask about.
function clean(title, browser) {
  let t = String(title || '').replace(/[\u0000-\u001f]/g, ' ').trim();
  t = t.replace(/^(?:\(\d+\+?\)|\[\d+\]|[*\u25cf\u2022])\s*/, '');
  if (browser) {
    const edge = /Edge\s*$/.test(t);
    t = t.replace(BROWSER_TAIL, '');
    if (edge) t = t.replace(EDGE_MORE, '');
    t = t.trim();
    if (SEARCH.test(t) || ELSEWHERE.test(t) || REPO.test(t)) return '';
  }
  return t.trim().slice(0, 300);
}

// What gives an AI away in a title, in her languages: "AI", "IA", "\u0418\u0418", chat, an assistant, GPT, LLM.
// A name the model doesn't know is taken for an AI only with one of these beside it.
const CUE = /(?:^|[^\p{L}])(?:AI|A\.I\.|IA|\u0418\u0418|GPT\w*|LLMs?)(?:$|[^\p{L}])|chat|czat|\u0447\u0430\u0442|assistant|asystent|asistente|assistente|\u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043d\u0442|\u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043d\u0442\u043a\u0430|chatbot|\bbots?\b/iu;

// a name as a key: lower case, letters and digits only, in any script ("Le Chat" → "lechat")
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);

function prompt(title, browser) {
  return [
    'You sort the windows on a PC. Pick the kind of this one:',
    '- ai_chat: an AI chatbot or AI assistant itself, its own chat page or its own app',
    '- ai_download: a page to download or install an AI chatbot or assistant',
    '- about_ai: an article, video, review, news, search results, forum, docs or shop page about an AI',
    '- not_ai: anything else (games, music, mail, code editors, office apps, sites and apps that only have an AI feature)',
    'and the name: that AI\'s short product name exactly as the title writes it, "" for about_ai and not_ai.',
    '',
    'Examples:',
    '"ChatGPT - Google Chrome" (browser tab) -> {"kind":"ai_chat","name":"ChatGPT"}',
    '"Poe - Fast, Helpful AI Chat" (browser tab) -> {"kind":"ai_chat","name":"Poe"}',
    '"LM Studio" (app) -> {"kind":"ai_chat","name":"LM Studio"}',
    '"Download Jan - Local AI Assistant" (browser tab) -> {"kind":"ai_download","name":"Jan"}',
    '"Is Pi better than ChatGPT? - YouTube" (browser tab) -> {"kind":"about_ai","name":""}',
    '"perplexity ai - Google Search" (browser tab) -> {"kind":"about_ai","name":""}',
    '"Elden Ring" (app) -> {"kind":"not_ai","name":""}',
    '"Inbox - Gmail" (browser tab) -> {"kind":"not_ai","name":""}',
    '"index.js - my-app - Visual Studio Code" (app) -> {"kind":"not_ai","name":""}',
    '',
    `This window: ${JSON.stringify(title)} (${browser ? 'browser tab' : 'app'})`,
  ].join('\n');
}

// The second question, about the name the first one gave: whether the model knows it as an AI. A small
// model takes nearly any name in a title for one (a school's e-register, a password manager, a friend
// in Messenger); asked about the name alone, with "don't know" to pick, it far less often says yes.
const NAME_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string', enum: ['yes', 'no', 'unknown'] } },
  required: ['answer'],
};

function namePrompt(name, title) {
  return [
    `Is "${name}" the name of an AI chatbot or AI assistant: software made for chatting with an AI or running AI language models (like ChatGPT, Claude, Poe, Pi, Character.AI, Replika, LM Studio, Jan, GPT4All, SillyTavern)?`,
    '- yes: you know this name, and that is what it is',
    '- no: you know this name, and it is something else (a website, shop, bank, school or government service, messenger, password manager, media player, browser, app store, game, translator, writing or grammar tool, office or design app, any tool with only an AI feature)',
    '- unknown: you don\'t know this name, or it is a person\'s name',
    '',
    `It came from this window title: ${JSON.stringify(title)}`,
  ].join('\n');
}

// The model's answer as she takes it: { key, name, page: 'chat' or 'download' }, or null (not another
// AI). A name the title doesn't have is taken for a guess, and turned down. `known`: the keys
// windows.ps1 gives the AIs on its list, by their names' slugs ("lechat" for Le Chat), so one found by
// the model is the same AI.
function verdict(answer, title, known = {}) {
  let a = answer;
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a);
    } catch {
      return null;
    }
  }
  if (!a || !['ai_chat', 'ai_download'].includes(a.kind)) return null;
  const name = String(a.name || '').replace(/[^\p{L}\p{N} .+'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 32);
  const key = slug(name);
  if (key.length < 2 || !slug(title).includes(key)) return null;
  return { key: known[key] || key, name, page: a.kind === 'ai_download' ? 'download' : 'chat' };
}

const parse = (s) => {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch {
    return null;
  }
};

// Both questions for one title: what kind of window it is, then, if another AI's, whether the model
// knows that name as one. An AI on windows.ps1's list needs no second question.
async function judge(title, browser, ask, known = {}) {
  const v = verdict(await ask(prompt(title, browser), SCHEMA), title, known);
  if (!v || Object.values(known).includes(v.key)) return v;
  if (SELF.test(v.key)) return null;
  const a = parse(await ask(namePrompt(v.name, title), NAME_SCHEMA));
  if (a?.answer === 'yes') return v;
  return a?.answer === 'unknown' && CUE.test(title.replace(v.name, ' ')) ? v : null;
}

// The spotter: check() for the window in front, each time it changes; the answer once the model gave
// one (null: not another AI, or not known yet: she asks, and onChange() once she knows).
function createSpotter({
  file, ask, known = {}, onChange = () => {}, onHealth = () => {}, now = Date.now,
  dwell = DWELL_MS, gap = GAP_MS, backoff = BACKOFF_MS, slowMs = SLOW_MS,
}) {
  const answers = new Map(); // hash -> { key, name, page } or null
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    // before the second question (a flat list): only its "not another AI"s still hold
    const old = kept.v !== VERSION;
    for (const [h, v] of Object.entries(old ? kept : kept.answers || {})) if (!old || v === null) answers.set(h, v);
  } catch {
    // nothing asked yet
  }
  const stored = () => JSON.stringify({ v: VERSION, answers: Object.fromEntries(answers) });
  let front = null;   // { h, title, browser, since }
  let asking = false;
  let next = 0;       // not before this
  let timer = null;
  let saveTimer = null;
  // how the model on this PC is doing: 'ok', 'slow' (answers too late) or 'down' (failed, or none), and since
  // how many failures in a row
  let health = 'ok';
  let fails = 0;
  const feel = (h) => {
    if (h === health) return;
    health = h;
    onHealth(h);
  };

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, stored());
      } catch (err) {
        console.error('[capri] could not save her answers about other AIs:', err.message);
      }
    }, SAVE_MS);
  };

  const keep = (h, v) => {
    answers.delete(h);
    answers.set(h, v);
    while (answers.size > KEEP) answers.delete(answers.keys().next().value);
    save();
  };

  const later = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(go, Math.max(0, ms));
  };

  async function go() {
    const f = front;
    if (!f || asking || answers.has(f.h)) return;
    const wait = Math.max(f.since + dwell, next) - now();
    if (wait > 0) return later(wait);
    asking = true;
    const t0 = now();
    try {
      const v = await judge(f.title, f.browser, ask, known);
      keep(f.h, v);
      fails = 0;
      if (now() - t0 > slowMs) {
        next = now() + backoff * 10; // it answered, too late to be of use: not for a while
        feel('slow');
      } else {
        next = now() + gap;
        feel('ok');
      }
      if (front?.h === f.h) onChange(v);
    } catch {
      // no model on this PC, or it failed: the list alone meanwhile, longer each time
      next = now() + Math.min(BACKOFF_MAX, backoff * 2 ** fails);
      fails++;
      feel('down');
    } finally {
      asking = false;
    }
    if (front && !answers.has(front.h)) later(next - now());
  }

  return {
    health: () => health,
    // The window in front now: its title (empty: none to ask about) and whether it's a browser.
    check(title, browser) {
      const t = clean(title, browser);
      if (t.length < 2) {
        front = null;
        return null;
      }
      const h = hash(`${browser ? 'b' : 'w'}|${t}`);
      if (answers.has(h)) {
        front = { h, title: t, browser, since: now() };
        return answers.get(h);
      }
      if (front?.h !== h) {
        front = { h, title: t, browser, since: now() };
        later(dwell);
      }
      return null;
    },
    // Nothing in front to ask about (a game, jealousy off, her own window).
    idle() {
      front = null;
      clearTimeout(timer);
    },
    // You said it's no AI (Mainframe): its titles are known as not, and not asked about again.
    forget(key) {
      let changed = false;
      for (const [h, v] of answers) {
        if (v?.key !== key) continue;
        answers.set(h, null);
        changed = true;
      }
      if (changed) save();
    },
    flush() {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      try {
        fs.writeFileSync(file, stored());
      } catch {
        // kept in memory only
      }
    },
  };
}

module.exports = { createSpotter, clean, verdict, judge, prompt, namePrompt, SCHEMA, NAME_SCHEMA };
