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
  line(kind, details, asked = null) {
    if (!this.may(kind)) return null;
    this.times.push(Date.now()); // a try counts, so a slow model doesn't get asked over and over
    if (kind === 'idle') this.lastIdle = Date.now();
    let late = false;
    const write = this.write(this.about(kind, details)).then((line) => {
      if (!line || late) return null;
      this.chat.keepAside(line, kind, asked);
      return line;
    });
    const wait = new Promise((resolve) => setTimeout(() => {
      late = true;
      resolve(null);
    }, WAIT_MS));
    return Promise.race([write, wait]);
  }

  async write(what) {
    const { chat } = this;
    if (!chat.open && !chat.turn) chat.history = await this.host.chatMemory().catch(() => chat.history);
    const lately = chat.recent();
    const prompt = [
      what,
      lately && `Your conversation with the user lately (only bring it up if it fits):\n${lately}`,
      this.mine.length && `What you said on your own lately (say something else, starting differently): ${this.mine.map((l) => `"${l}"`).join(' ')}`,
      chat.asideLanguage(),
    ].filter(Boolean).join('\n\n');
    const res = await this.host.talkLine({ messages: [{ role: 'system', content: chat.asidePersona() }, { role: 'user', content: prompt }] }).catch(() => null);
    const line = res?.ok ? clean(res.text).replace(/^["“«]\s*|\s*["”»]$/g, '').trim() : '';
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
      default: // idle
        return `Nothing is going on: ${this.brain.watching ? `${agent} is idle and ` : ''}the user hasn't said anything for a while. Start a little conversation yourself: one short line or question, about something from your conversations, the time of day, or you. Not the satellite unless it really fits.`;
    }
  }
}
