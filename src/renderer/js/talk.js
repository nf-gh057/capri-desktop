// What she says of her own, in her own words: about the task you just gave Claude Code or Codex, a long
// one done, one going badly, you coming back, and now and then just to talk. A model of hers writes it
// (main.js talkBrain: one on this PC, never the agent); without one, or past what she may say in an
// hour (Mainframe › RELIC: quiet, normal, chatty), she says her usual lines. What she says goes in her
// chat, so she knows what she meant if you ask, and in HOLO.

import { clean } from './chat.js';
import { duration } from './util.js';

const LEVELS = {
  quiet: null, // her usual lines only
  normal: { perHour: 4, gap: 3 * 60 * 1000, prompt: 0.35, idleEvery: 60 * 60 * 1000 },
  chatty: { perHour: 10, gap: 60 * 1000, prompt: 0.7, idleEvery: 20 * 60 * 1000 },
};
export const LONG_TASK_MS = 3 * 60 * 1000; // a task this long: she has something to say when it's done
export const STUCK_FAILS = 3; // failures in a row: it's going badly
const WAIT_MS = 7000; // her own line by then, or her usual one
const IDLE_CHANCE = 0.2; // her turn to start a conversation, checked every minute: this likely
// small models open every such line with "I saw…" or "I heard…" (and keep it vague after): not that
const WORLD_OPENING = 'Don\'t start with "I saw", "I heard" or "I read".';
const WORLD_KINDS = new Set(['game', 'news', 'release', 'day']);
// and a game's fact they tell far better with one done right before them (another fact: not to be copied; for
// the rest they only react, and copy an example word for word)
const LIKE_THIS = {
  game: 'Like this, for another game: "Did you know Hollow Knight\'s whole map was drawn by three people? Three, choom."',
};
// Her line without the facts shown under it, when a small model reads them out anyway: cut where they start
// (a run of 18 characters of them), or nothing if that leaves next to nothing
export function withoutEcho(line, under) {
  const facts = String(under || '');
  const text = String(line || '');
  let at = -1;
  for (let i = 0; i + 18 <= facts.length; i += 6) {
    const k = text.indexOf(facts.slice(i, i + 18));
    if (k >= 0 && (at < 0 || k < at)) at = k;
  }
  if (at < 0) return text;
  const kept = text.slice(0, at).replace(/[\s,;:–—-]+$/, '').trim();
  return kept.length >= 12 ? kept : null;
}

// what's shown right under her line (world.js): she reacts to it, she doesn't read it out
const UNDER = 'It\'s shown right under your line, so don\'t repeat it: react to it.';
const clip = (text, n) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

export class Talk {
  constructor({ host, chat, brain }) {
    this.host = host;
    this.chat = chat;
    this.brain = brain;
    this.level = 'normal';
    this.times = []; // when she said something of her own, this past hour
    this.mine = [];  // what she said lately, not to say again
    this.lastIdle = Date.now(); // she doesn't start a conversation right as she wakes up
    this.hush = () => false; // app.js: a game on, her chat open, a guide at work… (she keeps quiet)
  }

  configure(cfg) {
    this.level = cfg.talk in LEVELS ? cfg.talk : 'normal';
  }

  get rules() {
    return LEVELS[this.level];
  }

  // Whether she may say something of her own now, about `kind`
  may(kind) {
    const r = this.rules;
    if (!r || this.hush()) return false;
    const now = Date.now();
    this.times = this.times.filter((at) => now - at < 60 * 60 * 1000);
    if (this.times.length >= r.perHour || now - (this.times.at(-1) || 0) < r.gap) return false;
    if (kind === 'prompt' && Math.random() >= r.prompt) return false; // not every one of your prompts
    return true;
  }

  // Her turn to start a conversation (app.js, every minute, at a quiet moment): it's been long enough
  idleDue() {
    const r = this.rules;
    return Boolean(r) && Date.now() - this.lastIdle > r.idleEvery && Math.random() < IDLE_CHANCE;
  }

  // Her own line about `kind` (what happened: `details`, see about()), kept in her chat, or null: at
  // once if she won't say anything of her own now, else a promise (null in it if no line came in time:
  // her usual line is said instead, and hers is dropped). `asked`: your prompt it's about, kept before
  // it ({ text, to, tag }).
  // `under`: facts said as they are under her line (world.js: the weather, a headline); `fallback`: her line
  // when her model gives none, or one `check` turns down (one that lost the facts it was given)
  line(kind, details, asked = null, { under = '', fallback = null, check = null } = {}) {
    if (!this.may(kind)) return null;
    this.times.push(Date.now()); // a try counts, so a slow model doesn't get asked over and over
    if (kind === 'idle') this.lastIdle = Date.now();
    let late = false;
    let settled = false; // said once: her model's line, or the fallback when it's late
    const done = (own) => {
      if (settled) return null;
      settled = true;
      const mine = own && under ? withoutEcho(own, under) : own;
      let text = mine && (!check || check(mine)) ? mine : fallback;
      if (!text) return null;
      if (under) text = `${text}\n${under}`;
      this.chat.keepAside(text, kind, asked);
      return text;
    };
    const write = this.write(this.about(kind, details), { world: WORLD_KINDS.has(kind) }).then((line) => (late ? null : done(line)));
    const wait = new Promise((resolve) => setTimeout(() => {
      late = true;
      resolve(fallback ? done(null) : null);
    }, WAIT_MS));
    return Promise.race([write, wait]);
  }

  // `world`: a line about the world past the desktop (world.js): no conversation around it (a small model
  // says its last line again before the new one), and of what comes back only its last paragraph
  async write(what, { world = false } = {}) {
    const { chat } = this;
    if (!chat.open && !chat.turn) chat.history = await this.host.chatMemory().catch(() => chat.history);
    const lately = !world && chat.recent();
    const prompt = [
      what,
      lately && `Your conversation with the user lately (only bring it up if it fits):\n${lately}`,
      !world && this.mine.length && `What you said on your own lately (say something else, starting differently): ${this.mine.map((l) => `"${l}"`).join(' ')}`,
      chat.asideLanguage(),
    ].filter(Boolean).join('\n\n');
    const res = await this.host.talkLine({ messages: [{ role: 'system', content: chat.asidePersona() }, { role: 'user', content: prompt }] }).catch(() => null);
    let text = res?.ok ? String(res.text) : '';
    if (world) text = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).at(-1) || '';
    const line = clean(text).replace(/^["“«]\s*|\s*["”»]$/g, '').trim();
    if (!line || line.length > 320) return null; // nothing, or not a line (a model rambling on)
    this.mine = [...this.mine, line].slice(-6);
    return line;
  }

  // What happened, for her AI (in English, her language comes after)
  about(kind, d) {
    const agent = d.to || this.brain.name;
    switch (kind) {
      case 'prompt':
        return `The user just gave ${agent}, their coding assistant (not you), this task in the project "${d.project}": "${clip(d.prompt, 600)}". React to it in one short line, as yourself: what you make of it, a tease, or wishing them luck. Don't do it or explain it.`;
      case 'done':
        return `${agent} just finished a task in "${d.project}" after ${duration(d.ms, 'en')}.${d.last ? ` Its last words: "${clip(d.last, 500)}"` : ''} Tell the user ${agent} is done, in your own words, with what it did in a few words. ${agent} did it, not you: say so about ${agent} ("${agent} added…"), never "I added".`;
      case 'stuck':
        return d.fails
          ? `${agent} has failed ${d.fails} times in a row in "${d.project}" (last: ${clip(d.error, 160) || d.tool}). Say something to the user about it: worried, teasing or encouraging, short.`
          : `${agent} has been at it in "${d.project}" for ${duration(d.quiet, 'en')} without a sign of life. Tell the user, short: nothing froze, it's thinking.`;
      case 'back':
        return `The user is back at the PC after ${duration(d.away, 'en')} away. Welcome them back in one line; pick up where your conversation left off if it fits.`;
      // the world past their desktop (world.js): what's said is all from the sources, nothing made up
      case 'game':
        return `The user just stopped playing ${d.game} after ${duration(d.ms, 'en')}. ${d.tip ? 'A tip' : 'A fact'} about ${d.game}, from its Steam page or Wikipedia: "${clip(d.fact, 400)}" Tell them that ${d.tip ? 'tip' : 'fact'} in your own words, keeping its concrete details (names, numbers, places), in one or two short sentences, in character${d.tip ? '' : ' ("did you know…" is fine)'}. Nothing added, nothing made up. ${WORLD_OPENING} ${LIKE_THIS.game}`;
      case 'news':
        return `A headline from ${d.source} today: "${clip(d.title, 200)}"${d.summary ? ` (${clip(d.summary, 260)})` : ''}. Your own short take on it, one sentence, in character. ${UNDER} ${WORLD_OPENING}`;
      case 'release':
        return `${d.name} ${d.soon ? 'comes out' : 'just came out'} on Steam${d.date ? ` (${d.date})` : ''}${d.genres?.length ? `: ${d.genres.join(', ')}` : ''}${d.like?.length ? `, the same kind of game as ${d.like.join(' and ')}, which the user plays` : ''}. Tell the user in one short sentence, in character, why it could be their thing. ${UNDER} ${WORLD_OPENING}`;
      case 'day': {
        const w = d.weather;
        const name = this.brain.custom?.userName;
        const parts = [
          w && `in ${w.place} it's ${w.now}°C now, ${w.sky}; today ${w.min} to ${w.max}°C, ${w.day}${w.rain != null ? `, ${w.rain}% chance of rain` : ''}`,
          d.nameday && `name day today (a Polish custom): ${d.nameday}${name && d.nameday.toLowerCase().split(/,\s*/).includes(name.toLowerCase()) ? ' (the user\'s own name: wish them well!)' : ''}`,
          d.holiday && `today is ${d.holiday}, a public holiday`,
          d.tomorrow && `tomorrow is ${d.tomorrow}, a public holiday`,
        ].filter(Boolean);
        return `It's your first moment with the user today. Today: ${parts.join('; ')}. Greet them for the day in one short sentence, in character, reacting to one thing of it (the weather, a name day, the holiday). ${UNDER} ${WORLD_OPENING}`;
      }
      default: // idle
        return `Nothing is going on: ${this.brain.watching ? `${agent} is idle and ` : ''}the user hasn't said anything for a while. Start a little conversation yourself: one short line or question, about something from your conversations, the time of day, or you. Not the satellite unless it really fits.`;
    }
  }
}
