'use strict';

// Her voice (voice/server.py): a local text-to-speech server in its own Python environment, set up from Mainframe
// (voice/setup.ps1) in %USERPROFILE%\.capri\voice, never in the repo, with the voices made from recordings
// (profiles\) and what she's already said (cache\).
//
// What she says goes out in pieces: a sentence at a time (a short first one, to start sooner), each generated
// while the one before plays, so a long answer starts within a couple of seconds instead of after all of it.

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

function createVoice({ log = () => {}, onChange = () => {} } = {}) {
  let proc = null;
  let port = null;
  // state: off | starting | loading | ready | error
  const st = { state: 'off', error: null, device: null, profiles: [] };
  let installing = null; // the setup's last line, while it runs
  const token = crypto.randomBytes(24).toString('hex');
  let job = null;        // { id, queue: [text], lang, onPiece, busy }

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
        set({ state: h.state, error: h.error, device: h.device, profiles: h.profiles });
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
    if (!proc) return;
    const p = proc;
    proc = null;
    port = null;
    set({ state: 'off' });
    p.kill();
  }

  async function run(j) {
    if (j.busy) return;
    j.busy = true;
    while (job === j && j.queue.length) {
      const text = j.queue.shift();
      try {
        const res = await call('/say', { text, lang: j.lang, profile: j.profile, fx: j.fx });
        if (job === j) j.onPiece({ id: j.id, wav: Buffer.from(await res.arrayBuffer()), text });
      } catch (e) {
        log(`[voice] ${e.message}`);
        if (job === j) j.onPiece({ id: j.id, error: e.message, text });
      }
    }
    j.busy = false;
  }

  // Says text (more of it, for the same id: an answer still coming in); a new id stops the one before.
  function speak({ id, text, lang, profile = null, fx = 1 }, onPiece) {
    if (st.state !== 'ready') return false;
    if (!job || job.id !== id) job = { id, queue: [], lang, profile, fx, onPiece, busy: false };
    job.queue.push(...split(text));
    run(job);
    return true;
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
    start, stop, speak, hush, install, addProfile, installed,
    status: () => ({ installed: installed(), ...st, installing, home: HOME }),
  };
}

module.exports = { createVoice, split, clean, ready, HOME };
