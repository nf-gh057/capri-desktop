// What she brings up of the world past your desktop (main's world.js fetches it, talk.js puts it in her words):
// a fact or a tip about the game you just played, when you're back from it; and at a quiet moment, the day's
// greeting (the weather, name days, a holiday), a game coming out on Steam like yours, a headline from your
// feeds. How often (Mainframe › RELIC › WORLD: rarely, normal, often) on top of how chatty she is (talk.js): a
// line of hers here counts in the same hour as all the others. Never mid-game: a game in front hushes her.
//
// What she says is never left to a small model alone: the facts (the weather, a headline, a release) are shown as
// they are under her line, which only reacts to them; a game's fact her model tells in its words, unless it lost
// its names and numbers on the way: then the fact itself. No model: one of her usual lines over the facts.

import { fmt, pick } from './util.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RETRY_MS = 30 * 60 * 1000; // nothing came (a source down, no model): not again before this

// per how often: a game's fact after this many minutes of it, so many a day; headlines a day and the gap
// between two; releases a week
export const FREQ = {
  rare: { gameAfter: 45, gamePerDay: 1, newsPerDay: 1, newsGap: 5 * HOUR, releasesPerWeek: 1 },
  normal: { gameAfter: 20, gamePerDay: 3, newsPerDay: 2, newsGap: 3 * HOUR, releasesPerWeek: 3 },
  often: { gameAfter: 5, gamePerDay: 8, newsPerDay: 4, newsGap: 90 * 60 * 1000, releasesPerWeek: 7 },
};

const KEY = 'capri.world';

// Whether her telling of a fact kept something of it: one of its numbers or names (the first letters of it, Polish
// declines them: "Wiedźmin" -> "Wiedźminie"). A fact with neither: any telling.
export function keeps(fact, line) {
  const said = String(line).toLowerCase();
  const numbers = String(fact).match(/\d[\d.,]*/g) || [];
  const names = (String(fact).match(/(?<=\s)[A-ZĄĆĘŁŃÓŚŹŻ][\p{L}\d'-]{2,}/gu) || []).map((n) => n.toLowerCase().slice(0, Math.max(4, n.length - 2)));
  if (!numbers.length && !names.length) return true;
  return numbers.some((n) => said.includes(n.replace(/[.,]$/, ''))) || names.some((n) => said.includes(n));
}
const today = (at = Date.now()) => new Date(at).toDateString();

export class World {
  constructor({ host, talk, brain, now = () => Date.now(), store = globalThis.localStorage }) {
    Object.assign(this, { host, talk, brain, now, store });
    this.cfg = { talk: 'normal', gameFacts: false, releases: false, news: false, dayInfo: false };
    // what she said lately: { day, games, news: [at], releases: [at], greeted: day, tried: { kind: at } }
    this.said = { day: today(now()), games: 0, news: [], releases: [], greeted: null, tried: {} };
    try {
      const kept = JSON.parse(this.store?.getItem(KEY) || 'null');
      if (kept) this.said = { ...this.said, ...kept, tried: {} };
    } catch { /* first time, or no storage here */ }
  }

  configure(cfg) {
    this.cfg = {
      talk: FREQ[cfg.worldTalk] ? cfg.worldTalk : 'normal',
      gameFacts: Boolean(cfg.gameFacts), releases: Boolean(cfg.releases), news: Boolean(cfg.news), dayInfo: Boolean(cfg.dayInfo),
    };
  }

  get freq() {
    return FREQ[this.cfg.talk];
  }

  get t() {
    return this.brain.t.world;
  }

  // a weather code in her words: its group's (53, 55 are drizzle like 51)
  sky(code) {
    const at = Object.keys(this.t.sky).map(Number).filter((k) => k <= code);
    return at.length ? this.t.sky[Math.max(...at)] : '';
  }

  // the facts under her line, for each kind (as they are, in her language)
  under(kind, d) {
    const { t } = this;
    if (kind === 'day') {
      const w = d.weather;
      return [
        w && fmt(t.weather, { place: w.place, now: w.now, sky: this.sky(w.code), min: w.min, max: w.max, day: this.sky(w.dayCode) })
          + (w.rain >= 30 ? fmt(t.rain, { rain: w.rain }) : ''),
        d.nameday && fmt(t.nameday, { names: d.nameday }),
        d.holiday && fmt(t.holiday, { holiday: d.holiday }),
        d.tomorrow && fmt(t.tomorrow, { holiday: d.tomorrow }),
      ].filter(Boolean).join(' ');
    }
    if (kind === 'news') return fmt(t.news, { title: d.title, source: d.source });
    if (kind === 'release') return fmt(t.release, { name: d.name, when: d.soon && d.date ? d.date : t.out, genres: (d.genres || []).slice(0, 3).join(', ') });
    return '';
  }

  // what she says of it all, given to talk.js: the facts under her line, or (a game's fact) her model's telling
  // of it, checked for its names and numbers
  saying(kind, d) {
    const open = pick(this.t.open[kind]);
    if (kind === 'game') {
      return { fallback: `${open} ${fmt(this.t.fact, { game: d.game, fact: d.fact })}`, check: (line) => keeps(d.fact, line) };
    }
    return { under: this.under(kind, d), fallback: open };
  }

  keep() {
    try {
      const { tried, ...rest } = this.said;
      this.store?.setItem(KEY, JSON.stringify(rest));
    } catch { /* kept until she restarts */ }
  }

  // a new day: the day's counts start over
  roll() {
    const day = today(this.now());
    if (this.said.day !== day) Object.assign(this.said, { day, games: 0 });
    const now = this.now();
    this.said.news = this.said.news.filter((at) => now - at < DAY);
    this.said.releases = this.said.releases.filter((at) => now - at < 7 * DAY);
  }

  // tried lately and nothing came of it
  resting(kind) {
    return this.now() - (this.said.tried[kind] || 0) < RETRY_MS;
  }

  // A game started: what she knows of it fetched now, so she has it when you're back
  gameStarted(folder) {
    if (this.cfg.gameFacts) this.host.worldGame(folder, false).catch(() => {});
  }

  // Back from a game you played `ms`: her line about it (a fact or a tip, in her words), or null
  async afterGame(folder, ms) {
    this.roll();
    const f = this.freq;
    if (!this.cfg.gameFacts || ms < f.gameAfter * 60 * 1000 || this.said.games >= f.gamePerDay || !this.talk.may('game')) return null;
    const fact = await this.host.worldGame(folder, true).catch(() => null);
    if (!fact) return null;
    const line = await this.talk.line('game', { ...fact, ms }, null, this.saying('game', fact));
    if (line) {
      this.said.games++;
      this.keep();
    }
    return line;
  }

  // A quiet minute with you at your PC: one thing of the world, if one's due (the day's greeting first), as her
  // line, or null
  async tick() {
    this.roll();
    const f = this.freq;
    const now = this.now();
    const hour = new Date(now).getHours();
    const gap = (7 * DAY) / f.releasesPerWeek;
    // what's due, in order: the first that comes up with something is her line (one a minute at most)
    const due = [
      this.cfg.dayInfo && this.said.greeted !== this.said.day && hour >= 6
        && ['day', () => this.host.worldToday(), (info) => (info && (info.weather || info.nameday || info.holiday || info.tomorrow) ? info : null), () => { this.said.greeted = this.said.day; }],
      this.cfg.releases && this.said.releases.length < f.releasesPerWeek && now - (this.said.releases.at(-1) || 0) >= gap
        && ['release', () => this.host.worldRelease(), (r) => r, () => this.said.releases.push(now)],
      this.cfg.news && this.said.news.length < f.newsPerDay && now - (this.said.news.at(-1) || 0) >= f.newsGap
        && ['news', () => this.host.worldNews(), (n) => n, () => this.said.news.push(now)],
    ].filter(Boolean);
    for (const [kind, fetch, usable, done] of due) {
      if (this.resting(kind) || !this.talk.may(kind)) continue;
      const line = await this.try(kind, fetch, usable, done);
      if (line) return line;
    }
    return null;
  }

  async try(kind, fetch, usable, done) {
    const what = usable(await fetch().catch(() => null));
    const line = what && (await this.talk.line(kind, what, null, this.saying(kind, what)));
    if (!line) {
      this.said.tried[kind] = this.now();
      return null;
    }
    done();
    this.keep();
    return line;
  }
}
