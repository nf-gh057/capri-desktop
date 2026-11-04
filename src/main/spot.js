'use strict';

// Her jealousy past the names she knows (windows.ps1's list): the title of the window in front, a tab
// in your browser or an app, goes to a model on this PC, which says whether it's another AI (its chat,
// its app, a page to download it) and which. The title goes nowhere else: never to an AI online
// (main.js only asks a local model), never to her overlay, never written down; what's kept is a hash
// of it with the answer, so she doesn't ask about the same title twice.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DWELL_MS = 2000;     // in front this long before she asks (not every tab you flick past)
const GAP_MS = 1500;       // between two questions
const BACKOFF_MS = 60000;  // no model to ask, or it failed: not again before this
const KEEP = 3000;         // answers kept, the oldest forgotten first
const SAVE_MS = 5000;

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

// A title as she asks about it: no unread count in front ("(3) Inbox"), no unsaved mark, no browser.
// '' for one not to ask about.
function clean(title, browser) {
  let t = String(title || '').replace(/[\u0000-\u001f]/g, ' ').trim();
  t = t.replace(/^(?:\(\d+\+?\)|\[\d+\]|[*\u25cf\u2022])\s*/, '');
  if (browser) {
    const edge = /Edge\s*$/.test(t);
    t = t.replace(BROWSER_TAIL, '');
    if (edge) t = t.replace(EDGE_MORE, '');
    if (SEARCH.test(t.trim())) return '';
  }
  return t.trim().slice(0, 300);
}

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

// The spotter: check() for the window in front, each time it changes; the answer once the model gave
// one (null: not another AI, or not known yet: she asks, and onChange() once she knows).
function createSpotter({ file, ask, known = {}, onChange = () => {}, now = Date.now, dwell = DWELL_MS, gap = GAP_MS, backoff = BACKOFF_MS }) {
  const answers = new Map(); // hash -> { key, name, page } or null
  try {
    for (const [h, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) answers.set(h, v);
  } catch {
    // nothing asked yet
  }
  let front = null;   // { h, title, browser, since }
  let asking = false;
  let next = 0;       // not before this
  let timer = null;
  let saveTimer = null;

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(Object.fromEntries(answers)));
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
    try {
      const v = verdict(await ask(prompt(f.title, f.browser), SCHEMA), f.title, known);
      keep(f.h, v);
      next = now() + gap;
      if (front?.h === f.h) onChange(v);
    } catch {
      next = now() + backoff; // no model on this PC, or it failed: the list alone meanwhile
    } finally {
      asking = false;
    }
    if (front && !answers.has(front.h)) later(next - now());
  }

  return {
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
        fs.writeFileSync(file, JSON.stringify(Object.fromEntries(answers)));
      } catch {
        // kept in memory only
      }
    },
  };
}

module.exports = { createSpotter, clean, verdict, prompt, SCHEMA };
