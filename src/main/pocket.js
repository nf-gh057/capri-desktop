'use strict';

// Her chat in your pocket: a page of hers on your phone, opened at this PC's name on your Tailscale
// network (HTTPS, with the *.ts.net certificate Tailscale gives it). What you say goes from the phone
// to her and nowhere else: no Telegram, nobody's server in between.
//
// Who gets in: a phone or a tablet signed in to Tailscale with your account (Tailscale says which device
// each connection comes from, and what it runs: whois; anything else, a PC of yours too, gets nothing,
// not even the page), and of those only one paired with a code shown in Mainframe. Pairing, the phone's
// browser (or her app) makes a key of its own, one that can be used but never read out of it, and Capri
// keeps its public half. Each time the page opens it signs a fresh challenge with it, and gets a session
// for that device alone: another device of yours with the same cookie, or the same device without the
// key, gets nothing. A phone has a key for each page it paired on (a browser keeps one per address: one
// per PC of her swarm) and one for her app; her swarm shares them all (main.js), so the app pairs once.
// What the phone can do: talk to her chat, the one on your desktop, without her powers and with Claude
// Code or Codex only reading (main.js). Her app, and only her app, may give orders besides: each one signed
// on its own with her app's key, which Android lets it use only after your fingerprint (main.js has her do
// it, logs it, and tells Telegram). What it gets besides: her notes while
// you're away (Claude Code needs you, it's done, it crashed), numbered, the ones it missed sent again.
//
// Nothing here knows Electron: main.js hands in the certificate, who Tailscale says is calling, the
// paired phones, and her answers.

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 47825;
const PAIR_MS = 10 * 60 * 1000;       // how long a pairing code works
const PAIR_TRIES = 5;                 // wrong tries before it stops working
const CHALLENGE_MS = 60 * 1000;
const SESSION_MS = 12 * 60 * 60 * 1000;
const WHO_MS = 30 * 1000;             // what Tailscale said of an address, kept this long
const MAX_BODY = 16 * 1024;
const MAX_TEXT = 4000;
const PER_MINUTE = 10;
const NOTES = 50;                     // her notes kept for a phone that missed them
const NOTES_MS = 24 * 60 * 60 * 1000; // for a day at most
const MAX_KEYS = 12;                  // phones' keys kept: a page on each PC, her app
const COOKIE = 'capri_pocket';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: read off one screen, typed on another
const MOBILE = /^(android|ios)$/i; // what Tailscale says a phone or a tablet runs

// the page's own files, and nothing else of this PC's
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/pocket.js': ['pocket.js', 'text/javascript; charset=utf-8'],
  '/pocket.css': ['pocket.css', 'text/css; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  // her face, for the phone's home screen (Chrome installs her as an app with both sizes)
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
};

const HEADERS = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
    + "manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cache-control': 'no-store',
};

class PocketError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.status = status;
  }
}

// What a phone signs to open a session: the challenge, bound to what it's for
const signed = (challenge) => Buffer.from(`capri-pocket|${challenge}`);
// What her app signs for an order, after your fingerprint: a challenge of its own and that order, word for
// word (its SHA-256), so a signature can't be lifted onto another order
const orderSigned = (challenge, text) => Buffer.from(`capri-pocket-order|${challenge}|${crypto.createHash('sha256').update(String(text)).digest('hex')}`);

// A phone's public key as its browser sends it (JWK, P-256): only its public part, else null
function publicKey(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || 'd' in jwk) return null;
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || jwk.x.length > 64 || jwk.y.length > 64) return null;
  try {
    crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  } catch {
    return null;
  }
}

// whether `sig` (base64url, as WebCrypto signs: r and s side by side) is that key's, over `data`
function verify(jwk, data, sig) {
  try {
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(String(sig), 'base64url'));
  } catch {
    return false;
  }
}

// A paired phone's key as it's kept, and as another PC of her swarm sends it: checked, or null
function phoneRecord(p) {
  const key = publicKey(p?.key);
  if (!key || typeof p.id !== 'string' || !p.id || p.id.length > 100 || !Number.isFinite(p.at)) return null;
  const via = typeof p.via === 'string' && p.via.length <= 200 ? p.via : null;
  return { id: p.id, name: String(p.name || p.id).slice(0, 60), key, at: p.at, ...(via && { via }) };
}

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const cookie = (req) => (/(?:^|;\s*)capri_pocket=([\w-]{20,})/.exec(String(req.headers.cookie || '')) || [])[1] || null;

// `host`, `port`: where to listen (this PC's Tailscale address); `tls`: { cert, key }, or null for plain
// HTTP (tests and --dev on 127.0.0.1 only); `origins`: the page's own address(es), the only ones its
// requests may come from; `dir`: the page's files.
// `whois(address)`: the device Tailscale says is there, { node, name, user } or null; `mine(who)`:
// whether it's signed in with your account. `phones()`: the paired phones' keys, [{ id (the device), name,
// key, at, via (where it paired: a page's address, or 'app') }], and `onPhones(list)`: the list to save. `ask(text, { node, delta })`: her answer to your message, { ok,
// text } or { ok: false, error }, `delta(text)` as it's written; `history()`: her chat so far, [{ role,
// content, at }]; `labels()`: the page's words, in her language; `name()`: this PC's; `pcs()`: her page
// on the other PCs of her swarm, [{ name, url, active }]. `remember`: how
// long what Tailscale said of an address is kept (ms).
function createPocket({
  host = '127.0.0.1', port = PORT, remember = WHO_MS, tls = null, origins = [], dir, whois, mine = () => false, phones = () => [], onPhones = () => {},
  ask = async () => ({ ok: false, error: 'offline' }), history = () => [], labels = () => ({}), name = () => '', pcs = () => [],
}) {
  const who = new Map();        // address -> { at, it }
  const challenges = new Map(); // challenge -> { node, at }
  const sessions = new Map();   // token -> { node, until }
  const streams = new Set();    // { node, res }: pages listening for her answers
  const sent = new Map();       // node -> [times]: messages in the last minute
  const notes = [];             // { id, at, line, project, quote }: her notes, oldest first
  let pair = null;              // { code, until, tries }
  let server = null;
  let ping = null;
  let queue = Promise.resolve(); // your messages, answered one after the other

  async function identify(address) {
    const now = Date.now();
    const hit = who.get(address);
    if (hit && now - hit.at < remember) return hit.it;
    const it = await Promise.resolve(whois(address)).catch(() => null);
    who.set(address, { at: now, it });
    if (who.size > 200) for (const [a, w] of who) if (now - w.at > remember) who.delete(a);
    return it;
  }

  const phoneOf = (node) => phones().find((p) => p.id === node) || null;

  // a one-time challenge for this device, for a session (`hello`) or for one order
  function challenge(node, purpose = 'hello') {
    const now = Date.now();
    for (const [c, ch] of challenges) if (now - ch.at > CHALLENGE_MS) challenges.delete(c);
    const c = crypto.randomBytes(24).toString('base64url');
    challenges.set(c, { node, at: now, purpose });
    return c;
  }

  // the challenge given, if it's this device's, for this, and fresh: it works once, right or wrong
  function spend(device, given, purpose) {
    const ch = challenges.get(String(given || ''));
    challenges.delete(String(given || ''));
    return Boolean(ch && ch.node === device.node && ch.purpose === purpose && Date.now() - ch.at <= CHALLENGE_MS);
  }

  // the session this request carries, if it's this device's and the device is still paired
  function session(req, device) {
    const token = cookie(req);
    const s = token && sessions.get(token);
    if (!s || s.until < Date.now() || s.node !== device.node || !phoneOf(device.node)) throw new PocketError('noSession', 401);
    return token;
  }

  // what you sent from your phone, to her, and her answer to every page of that phone open (`order`: an
  // order from her app, signed after your fingerprint)
  function send(device, text, order = false) {
    const now = Date.now();
    const times = (sent.get(device.node) || []).filter((at) => now - at < 60000);
    if (times.length >= PER_MINUTE) throw new PocketError('tooMany', 429);
    times.push(now);
    sent.set(device.node, times);
    const id = crypto.randomUUID();
    const tell = (kind, body) => {
      const data = `event: ${kind}\ndata: ${JSON.stringify({ id, ...body })}\n\n`;
      for (const s of streams) if (s.node === device.node) s.res.write(data);
    };
    queue = queue
      .then(() => ask(text, { node: device.node, name: device.name, order, delta: (piece) => tell('delta', { text: String(piece) }) }))
      .then((a) => tell('answer', a?.ok ? { ok: true, text: String(a.text || '') } : { ok: false, error: String(a?.error || '…') }))
      .catch((err) => tell('answer', { ok: false, error: String(err?.message || '…') }));
    return { id };
  }

  const routes = {
    // who's there, and whether this phone is paired (then a challenge for its key to sign)
    'GET /api/start': (device) => {
      const paired = Boolean(phoneOf(device.node));
      return {
        name: name(), device: device.name, paired, pairing: Boolean(pair && pair.until > Date.now()),
        challenge: paired ? challenge(device.node) : null, t: labels(), pcs: pcs(),
      };
    },
    // this phone, with the code shown in Mainframe and the public half of the key its browser (or her
    // app: `client: 'app'`) made
    'POST /api/pair': (device, body, _res, req) => {
      if (!pair || pair.until < Date.now() || pair.tries >= PAIR_TRIES) throw new PocketError('noPairing');
      const key = publicKey(body?.key);
      if (!key) throw new PocketError('badKey', 400);
      const typed = String(body?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!same(typed, pair.code)) {
        pair.tries += 1;
        throw new PocketError('badCode');
      }
      // the same device paired again from the same place (its key lost: the page cleared, the app put in
      // again) takes its place; its keys from elsewhere (another PC's page, her app) stay
      const via = body?.client === 'app' ? 'app' : req.headers.origin;
      const others = phones().filter((p) => p.id !== device.node || (p.via || origins[0]) !== via);
      if (others.length >= MAX_KEYS) throw new PocketError('tooManyPhones');
      pair = null;
      onPhones([...others, { id: device.node, name: device.name, key, at: Date.now(), via }]);
      for (const [token, s] of sessions) if (s.node === device.node) sessions.delete(token);
      return { ok: true, challenge: challenge(device.node) };
    },
    // the challenge signed with one of this phone's keys: a session for it
    'POST /api/hello': (device, body, res) => {
      const keys = phones().filter((p) => p.id === device.node);
      if (!spend(device, body?.challenge, 'hello') || !keys.length) throw new PocketError('noChallenge');
      if (!keys.some((p) => verify(p.key, signed(body.challenge), body.sig))) throw new PocketError('badSig');
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, { node: device.node, until: Date.now() + SESSION_MS });
      res.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${tls ? '; Secure' : ''}`);
      return { ok: true };
    },
    'GET /api/history': (device, _body, _res, req) => {
      session(req, device);
      return { history: history().slice(-60).map(({ role, content, at }) => ({ role, content: String(content), at: at || 0 })) };
    },
    'POST /api/send': (device, body, _res, req) => {
      session(req, device);
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > MAX_TEXT) throw new PocketError('badText', 400);
      return send(device, text);
    },
    // a challenge for one order (her app signs it with the order, after your fingerprint)
    'GET /api/challenge': (device, _body, _res, req) => {
      session(req, device);
      return { challenge: challenge(device.node, 'order') };
    },
    // an order from her app: only a key her app made (not a page in a browser) may give one, each signed on
    // its own, after your fingerprint; then she does it, as if you'd typed it at the PC
    'POST /api/order': (device, body, _res, req) => {
      session(req, device);
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > MAX_TEXT) throw new PocketError('badText', 400);
      const keys = phones().filter((p) => p.id === device.node && p.via === 'app');
      if (!keys.length) throw new PocketError('notApp');
      if (!spend(device, body?.challenge, 'order')) throw new PocketError('noChallenge');
      if (!keys.some((p) => verify(p.key, orderSigned(body.challenge, text), body.sig))) throw new PocketError('badSig');
      return send(device, text, true);
    },
    'POST /api/bye': (device, _body, res, req) => {
      sessions.delete(session(req, device));
      res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${tls ? '; Secure' : ''}`);
      return { ok: true };
    },
  };

  // a note as the stream carries it: its time is its number, for the phone to say where it got to
  const noteEvent = (n) => `id: ${n.at}\nevent: note\ndata: ${JSON.stringify(n)}\n\n`;

  // her answers and her notes as they come, for as long as the page is open; first the notes after the
  // last one it saw (`since`, or what the browser says when it comes back: Last-Event-ID), if it says
  function listen(device, req, res) {
    session(req, device);
    const asked = new URL(req.url, 'http://x').searchParams.get('since');
    const since = Number(req.headers['last-event-id']) || Number(asked) || 0;
    res.writeHead(200, { ...HEADERS, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' });
    res.write(': hello\n\n');
    if (since > 0) for (const n of notes) if (n.at > since) res.write(noteEvent(n));
    const s = { node: device.node, res };
    streams.add(s);
    req.on('close', () => streams.delete(s));
  }

  // A note of hers for your phone (main.js decides when: you're away from all your PCs), kept a while and
  // sent to every page listening. The same note from another PC of her swarm (its id) is taken once.
  function note({ id, at, line, project = '', quote = '' } = {}) {
    if (typeof id !== 'string' || !id || id.length > 64 || !Number.isFinite(at) || typeof line !== 'string' || !line) return false;
    if (Date.now() - at > NOTES_MS) return false; // too old to be news
    if (notes.some((n) => n.id === id)) return false;
    const n = { id, at, line: line.slice(0, 300), project: String(project).slice(0, 120), quote: String(quote).slice(0, 400) };
    notes.push(n);
    notes.sort((a, b) => a.at - b.at);
    while (notes.length > NOTES || (notes.length && Date.now() - notes[0].at > NOTES_MS)) notes.shift();
    for (const s of streams) s.res.write(noteEvent(n));
    return true;
  }

  function file(res, route) {
    const [name, type] = FILES[route];
    fs.readFile(path.join(dir, name), (err, data) => {
      if (err) return reply(res, 404, { error: 'notFound' });
      res.writeHead(200, { ...HEADERS, 'content-type': type });
      res.end(data);
    });
  }

  function reply(res, status, json) {
    if (res.headersSent) return res.end();
    res.writeHead(status, { ...HEADERS, 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(json));
  }

  // what comes in: from a device of yours, or nothing at all
  async function handle(req, res) {
    const address = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const device = await identify(address);
    if (!device?.node || !mine(device) || !MOBILE.test(device.os || '')) {
      res.writeHead(403, { connection: 'close' });
      return res.end();
    }
    const route = String(req.url || '/').split('?')[0];
    if (req.method === 'GET' && FILES[route]) return file(res, route);
    if (req.method === 'GET' && route === '/api/events') {
      try {
        return listen(device, req, res);
      } catch (err) {
        return reply(res, err.status || 400, { error: err.message });
      }
    }
    const run = routes[`${req.method} ${route}`];
    if (!run) return reply(res, 404, { error: 'notFound' });
    // asked by the page itself, nothing else (another site, a link): its own address, and JSON
    if (req.method === 'POST' && (!origins.includes(req.headers.origin) || !/^application\/json\b/.test(req.headers['content-type'] || ''))) {
      return reply(res, 403, { error: 'origin' });
    }
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      text += c;
      if (text.length > MAX_BODY) req.destroy();
    });
    req.on('end', async () => {
      try {
        const body = req.method === 'POST' ? JSON.parse(text || '{}') : null;
        reply(res, 200, await run(device, body, res, req));
      } catch (err) {
        reply(res, err instanceof PocketError ? err.status : 400, { error: err instanceof PocketError ? err.message : 'bad' });
      }
    });
  }

  async function start() {
    server = tls ? https.createServer({ cert: tls.cert, key: tls.key }, handle) : http.createServer(handle);
    server.headersTimeout = 10000;
    server.requestTimeout = 15000; // the request itself: her answers come on their own stream
    await new Promise((resolve) => {
      server.once('error', resolve); // taken, or that address is gone
      server.listen(port, host, resolve);
    });
    if (!server.listening) {
      server = null;
      return false;
    }
    // a word now and then, so a phone's network doesn't drop a quiet stream
    ping = setInterval(() => { for (const s of streams) s.res.write(': ping\n\n'); }, 20000);
    return true;
  }

  function stop() {
    clearInterval(ping);
    for (const s of streams) s.res.end();
    streams.clear();
    sessions.clear();
    if (server) {
      server.close();
      server.closeAllConnections();
    }
    server = null;
  }

  // a code for a phone to pair with, shown in Mainframe: "ABCDE-FGHJK"
  function startPairing() {
    const code = Array.from(crypto.randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('');
    pair = { code, until: Date.now() + PAIR_MS, tries: 0 };
    return { code, text: `${code.slice(0, 5)}-${code.slice(5)}`, until: pair.until };
  }

  // a phone unpaired in Mainframe: its sessions end, and its pages stop hearing her
  function forget(node) {
    for (const [token, s] of sessions) if (s.node === node) sessions.delete(token);
    for (const s of streams) if (s.node === node) { s.res.end(); streams.delete(s); }
  }

  return {
    start, stop, startPairing, forget, note,
    stopPairing: () => { pair = null; },
    pairing: () => Boolean(pair && pair.until > Date.now() && pair.tries < PAIR_TRIES),
    setCert: (next) => server?.setSecureContext?.({ cert: next.cert, key: next.key }), // a renewed certificate, without a restart
    listening: () => Boolean(server?.listening),
  };
}

module.exports = { createPocket, publicKey, phoneRecord, verify, signed, orderSigned, PocketError, PORT, PAIR_MS, PAIR_TRIES, MAX_TEXT };
