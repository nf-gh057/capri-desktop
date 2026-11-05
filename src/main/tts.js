'use strict';

// Her voice (voice/server.py): a local text-to-speech server in its own Python environment, set up from Mainframe
// (voice/setup.ps1) in %USERPROFILE%\.capri\voice, never in the repo, with the voices made from recordings
// (profiles\) and what she's already said (cache\).
//
// What she says goes out in pieces: a sentence at a time (a short first one, to start sooner), each generated
// while the one before plays, so a long answer starts within a couple of seconds instead of after all of it.
//
// Not every PC keeps up: no NVIDIA card, or one shared with a game or a big model. The server times her on a line
// once loaded, and each line it makes: slower than she talks, and she keeps to text for a while (SLOW_MS), except
// for what she has said before (its cache). Her fixed lines (lines.js) are made ahead of time, one at a time
// while she's quiet (warm()), so those she always says at once, even on a slow day.

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.CAPRI_VOICE_HOME || path.join(os.homedir(), '.capri', 'voice');
const SERVER = path.join(__dirname, '..', '..', 'voice', 'server.py');
const SETUP = path.join(__dirname, '..', '..', 'voice', 'setup.ps1');
const PIECE = 220;  // the longest piece, in characters (a cache of 768 tokens on the server holds it)
const FIRST = 90;   // a longer first sentence is cut at a comma, so she starts talking sooner
const SLOW = 1.0;   // seconds to make a second of her voice, past which she'd stall between sentences
const SLOW_MS = 10 * 60 * 1000; // too slow: text (and what she's said before) only, this long, then she tries again
const QUIET_MS = 15000;          // her lines made ahead of time only after this long without her talking
const WARM_GAP_MS = 400;         // between two of them (the card isn't only hers)

const python = () => path.join(HOME, 'env', process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');

// What she shouldn't read out: code, links, markdown marks, emoji and her stage tags.
function clean(text) {
  return String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[[a-z_:-]+\]/gi, ' ')
    .replace(/[*_#>~|]+/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sentences, the long ones cut at a comma (else a space), the tiny ones ("Hm.") joined to the next.
function split(text) {
  // a sentence ends at its mark followed by a space (not the dot in "0.5" or "main.js")
  const sentences = clean(text).match(/[\s\S]+?(?:[.!?…]+["”»)]*(?=\s|$)|$)/g) || [];
  const out = [];
  for (let s of sentences.map((x) => x.trim()).filter(Boolean)) {
    const limit = out.length ? PIECE : FIRST;
    while (s.length > limit) {
      const head = s.slice(0, limit);
      const at = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(' – '), head.lastIndexOf(' — '));
      const cut = at > limit * 0.3 ? at + 1 : head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : limit;
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut).trim();
    }
    if (s) out.push(s);
  }
  // a piece of a word or two goes with the next one ("Hm. Not bad." is one breath)
  return out.reduce((acc, s) => {
    const last = acc[acc.length - 1];
    if (last !== undefined && last.length < 12 && last.length + s.length < PIECE) acc[acc.length - 1] = `${last} ${s}`;
    else acc.push(s);
    return acc;
  }, []);
}

// The part of a growing answer that's whole sentences, past what's been said already: { text, upTo }.
// Done, the rest goes too.
function ready(text, said, done) {
  const rest = text.slice(said);
  if (done) return { text: rest, upTo: text.length };
  const m = rest.match(/^[\s\S]*[.!?…]["”»)]*(?=\s)/);
  return m ? { text: m[0], upTo: said + m[0].length } : { text: '', upTo: said };
}

// Too slow to keep up? The speeds of the last few lines she made (seconds per second of voice).
function tooSlow(speeds) {
  const last = speeds.slice(-3);
  return last.length > 0 && last.reduce((a, b) => a + b, 0) / last.length > SLOW;
}

// Her fixed lines as pieces to make ahead of time: split as she'd say them, each once, the short ones too.
function pieces(lines) {
  const seen = new Set();
  for (const line of lines) if (typeof line === 'string') for (const p of split(line)) if (p.length >= 2) seen.add(p);
  return [...seen];
}

function createVoice({ log = () => {}, onChange = () => {}, now = Date.now } = {}) {
  let proc = null;
  let port = null;
  // state: off | starting | loading | ready | error
  // slowUntil: too slow on this PC right now, text only until then (speed: her last measure)
  const st = { state: 'off', error: null, device: null, speed: null, slowUntil: 0, profiles: [] };
  let installing = null; // the setup's last line, while it runs
  const token = crypto.randomBytes(24).toString('hex');
  let job = null;        // { id, queue: [text], lang, onPiece, busy }
  let speeds = [];       // of the lines made lately
  let lastTalk = 0;      // when she last said something
  // her fixed lines to make ahead of time: { key, list, at (made so far), opts: { lang, profile, fx } }
  let warmth = null;
  let warmTimer = null;
  const slow = () => now() < st.slowUntil;
  const measured = (speed) => {
    if (typeof speed !== 'number' || !Number.isFinite(speed)) return;
    speeds = [...speeds, speed].slice(-3);
    st.speed = speed;
    if (tooSlow(speeds) && !slow()) {
      log(`[voice] too slow here (${speed}s per second of voice): text only for a while`);
      speeds = [];
      set({ slowUntil: now() + SLOW_MS });
    }
  };

  const set = (patch) => {
    Object.assign(st, patch);
    onChange();
  };

  const installed = () => fs.existsSync(python()) && fs.existsSync(SERVER);

  async function call(route, body, timeout = 120000) {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-voice-token': token, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res;
  }

  async function watch() {
    while (proc && port) {
      try {
        const h = await (await call('/health')).json();
        const first = st.state !== 'ready' && h.state === 'ready';
        set({ state: h.state, error: h.error, device: h.device, profiles: h.profiles });
        if (first) {
          st.speed = h.speed;
          if (typeof h.speed === 'number' && h.speed > SLOW) {
            log(`[voice] too slow here (${h.speed}s per second of voice): text only for a while`);
            set({ slowUntil: now() + SLOW_MS });
          }
          later(QUIET_MS);
        }
        if (h.state !== 'loading') return;
      } catch { /* still starting */ }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  function start() {
    if (proc || !installed()) return;
    set({ state: 'starting', error: null });
    proc = spawn(python(), [SERVER, '--home', HOME], {
      env: { ...process.env, CAPRI_VOICE_TOKEN: token, CAPRI_PID: String(process.pid), PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const me = proc;
    me.stderr.on('data', (d) => String(d).split('\n').filter((l) => l.startsWith('[voice]')).forEach((l) => log(l)));
    me.stdout.once('data', (d) => {
      try {
        port = JSON.parse(String(d).split('\n')[0]).port;
        set({ state: 'loading' });
        watch();
      } catch {
        set({ state: 'error', error: String(d).slice(0, 200) });
      }
    });
    me.on('exit', (code) => {
      if (proc !== me) return;
      proc = null;
      port = null;
      set(st.state === 'off' ? {} : { state: code ? 'error' : 'off', error: code ? `exit ${code}` : null });
    });
  }

  function stop() {
    job = null;
    clearTimeout(warmTimer);
    if (!proc) return;
    const p = proc;
    proc = null;
    port = null;
    set({ state: 'off', speed: null, slowUntil: 0 });
    speeds = [];
    p.kill();
  }

  async function run(j) {
    if (j.busy) return;
    j.busy = true;
    while (job === j && j.queue.length) {
      const text = j.queue.shift();
      // too slow here: only what she has said before, and only if from its start (not half a line)
      const cached = slow();
      if (j.silent) {
        j.onPiece({ id: j.id, skip: true, text });
        continue;
      }
      try {
        const res = await call('/say', { text, lang: j.lang, profile: j.profile, fx: j.fx, ...(cached && { cached: true }) });
        if (res.status === 204) {
          j.silent = true;
          if (job === j) j.onPiece({ id: j.id, skip: true, text });
          continue;
        }
        measured(Number(res.headers.get('x-speed')) || undefined);
        if (job === j) j.onPiece({ id: j.id, wav: Buffer.from(await res.arrayBuffer()), text });
      } catch (e) {
        log(`[voice] ${e.message}`);
        if (job === j) j.onPiece({ id: j.id, error: e.message, text });
      }
    }
    j.busy = false;
    lastTalk = now();
    later(QUIET_MS);
  }

  // Says text (more of it, for the same id: an answer still coming in); a new id stops the one before.
  function speak({ id, text, lang, profile = null, fx = 1 }, onPiece) {
    if (st.state !== 'ready') return false;
    if (!job || job.id !== id) job = { id, queue: [], lang, profile, fx, onPiece, busy: false };
    job.queue.push(...split(text));
    lastTalk = now();
    run(job);
    return true;
  }

  // Her fixed lines, to make ahead of time while she's quiet (the overlay sends them in her language, as she says
  // them). The same list again changes nothing; another one (her language, her voice) starts over.
  function warm(lines, opts) {
    const list = pieces(Array.isArray(lines) ? lines : []);
    const key = JSON.stringify([opts, list.length, list[0], list[list.length - 1]]);
    if (warmth?.key === key) return;
    warmth = { key, list, at: 0, opts };
    later(QUIET_MS);
    onChange();
  }

  const later = (ms) => {
    clearTimeout(warmTimer);
    warmTimer = setTimeout(warmOne, ms);
  };

  // One of her lines made ahead, if she's ready, quiet, fast enough, and on a graphics card (on the processor
  // it would hold it for an hour).
  async function warmOne() {
    const w = warmth;
    if (!w || w.at >= w.list.length || st.state !== 'ready' || !proc) return;
    if (slow() || /^cpu$/i.test(st.device || '')) return later(60000);
    const quiet = now() - lastTalk;
    if (job?.busy || quiet < QUIET_MS) return later(Math.max(1000, QUIET_MS - quiet));
    const text = w.list[w.at];
    try {
      const r = await (await call('/say', { text, ...w.opts, warm: true })).json();
      if (warmth !== w) return;
      w.at++;
      if (w.at === w.list.length || w.at % 20 === 0) onChange();
      if (typeof r.speed === 'number' && r.speed > SLOW * 1.5) return later(120000); // the card is busy: later
      later(r.cached ? 0 : WARM_GAP_MS);
    } catch (e) {
      log(`[voice] ahead of time: ${e.message}`);
      later(60000);
    }
  }

  function hush(id) {
    if (!id || job?.id === id) job = null;
  }

  async function addProfile({ src, name, lang }) {
    const id = path.basename(src).replace(/\.[^.]+$/, '');
    const res = await call('/profile', { src, id, name: name || id, lang }, 300000);
    const made = await res.json();
    await watch();
    return made;
  }

  // Sets up her voice's Python environment (voice/setup.ps1); onLine gets each line of its output.
  function install(onLine = () => {}) {
    if (installing !== null) return Promise.resolve(false);
    installing = '';
    onChange();
    return new Promise((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SETUP, '-VoiceHome', HOME],
        { windowsHide: true });
      const line = (d) => String(d).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((l) => {
        installing = l.slice(0, 160);
        onLine(l);
        onChange();
      });
      p.stdout.on('data', line);
      p.stderr.on('data', line);
      p.on('exit', (code) => {
        installing = null;
        onChange();
        resolve(code === 0 && installed());
      });
    });
  }

  return {
    start, stop, speak, hush, warm, install, addProfile, installed,
    status: () => ({
      installed: installed(), ...st, slow: slow(), installing, home: HOME,
      ahead: warmth ? { done: warmth.at, total: warmth.list.length } : null,
    }),
  };
}

module.exports = { createVoice, split, clean, ready, tooSlow, pieces, HOME };
