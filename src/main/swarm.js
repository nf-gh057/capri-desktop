'use strict';

// Her swarm: one Capri on several PCs, wherever they are, linked through Tailscale (a private
// WireGuard network: each device keeps one 100.x.y.z address, whatever network it's on).
//
// Each Capri has a key of her own (X25519). Two PCs pair once with a code shown in Mainframe on one
// and pasted on the other; from then on, every pair shares a key of its own, and everything between
// them is sealed with it (AES-256-GCM) on top of WireGuard, with a time and a one-time number that
// can't be played again. A PC that joins learns the rest of the swarm from the one it paired with.
// What comes from another PC is only its state (here, locked, how long idle): never something to run.
//
// Nothing here knows Electron: main.js hands in the private key (unsealed), how this PC is doing,
// and saves what changes.

const http = require('node:http');
const os = require('node:os');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');

const VERSION = 1;
const PORT = 47824;
const PAIR_MS = 10 * 60 * 1000;   // how long a pairing code works
const PAIR_TRIES = 5;             // wrong tries before it stops working
const SKEW_MS = 5 * 60 * 1000;    // clocks a little apart still pass; older is refused
const MAX_BODY = 64 * 1024;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: read off one screen, typed on another

class SwarmError extends Error {}

// --- keys --------------------------------------------------------------------------------------

// A new identity: { id, pub, key } (pub and key as base64 DER; id: from the public key)
function identity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { id: nodeId(pub), pub, key: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') };
}

const nodeId = (pub) => crypto.createHash('sha256').update(String(pub)).digest('hex').slice(0, 16);

// The key a pair of PCs shares: the same on both sides, never sent
function pairKey(key, theirPub) {
  const secret = crypto.diffieHellman({
    privateKey: crypto.createPrivateKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'pkcs8' }),
    publicKey: crypto.createPublicKey({ key: Buffer.from(theirPub, 'base64'), format: 'der', type: 'spki' }),
  });
  return Buffer.from(crypto.hkdfSync('sha256', secret, Buffer.from('capri-swarm'), Buffer.from(`v${VERSION}`), 32));
}

// Sealed for one PC: { v, from, to, iv, data }. Inside: { ts, nonce, kind, body }.
function seal(sharedKey, from, to, kind, body, now = Date.now()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sharedKey, iv);
  cipher.setAAD(Buffer.from(`${from}>${to}`));
  const plain = JSON.stringify({ ts: now, nonce: crypto.randomBytes(12).toString('base64'), kind, body });
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { v: VERSION, from, to, iv: iv.toString('base64'), data: data.toString('base64') };
}

// Opened, or a SwarmError: not for us, tampered with, too old, or seen before (`seen`: a Map of nonces)
function open(sharedKey, message, me, seen, now = Date.now()) {
  if (message?.v !== VERSION || message.to !== me) throw new SwarmError('notForUs');
  let inside;
  try {
    const data = Buffer.from(String(message.data), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', sharedKey, Buffer.from(String(message.iv), 'base64'));
    decipher.setAAD(Buffer.from(`${message.from}>${message.to}`));
    decipher.setAuthTag(data.subarray(data.length - 16));
    inside = JSON.parse(Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8'));
  } catch {
    throw new SwarmError('tampered');
  }
  if (!Number.isFinite(inside.ts) || Math.abs(now - inside.ts) > SKEW_MS) throw new SwarmError('stale');
  const nonce = `${message.from}:${inside.nonce}`;
  if (seen.has(nonce)) throw new SwarmError('replayed');
  seen.set(nonce, now);
  for (const [n, at] of seen) if (now - at > 2 * SKEW_MS) seen.delete(n);
  return inside;
}

// --- pairing -----------------------------------------------------------------------------------

// A pairing code, as one line to paste on the other PC: "address:port/CODE"
function invite(address, port) {
  const code = Array.from(crypto.randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return { code, text: `${address}:${port}/${code.slice(0, 5)}-${code.slice(5)}`, until: Date.now() + PAIR_MS };
}

function readInvite(text) {
  const m = /^\s*\[?([\w.:-]+?)\]?:(\d{2,5})\/([A-Z2-9]{5})-?([A-Z2-9]{5})\s*$/i.exec(String(text || ''));
  return m && { host: m[1], port: Number(m[2]), code: `${m[3]}${m[4]}`.toUpperCase() };
}

// proof that one side knows the code, bound to its key (and the PC that showed it, to both keys),
// so it can't be lifted onto another
const proof = (code, role, ...pubs) => crypto.createHmac('sha256', code).update([role, ...pubs].join('|')).digest('base64');
const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// --- this PC -----------------------------------------------------------------------------------

const TAILSCALE = ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe'];

// Tailscale here: { ip, name, peers: [{ name, ip, online }] }, or null (not installed, not signed in)
async function tailscale() {
  for (const exe of TAILSCALE) {
    const out = await new Promise((resolve) => {
      execFile(exe, ['status', '--json'], { timeout: 5000, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout));
    });
    if (!out) continue;
    try {
      const s = JSON.parse(out);
      if (s.BackendState !== 'Running') return { ip: null, state: s.BackendState };
      const ip4 = (ips) => (ips || []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || null;
      return {
        ip: ip4(s.Self?.TailscaleIPs),
        name: s.Self?.HostName || null,
        state: 'Running',
        peers: Object.values(s.Peer || {}).map((p) => ({ name: p.HostName, ip: ip4(p.TailscaleIPs), online: Boolean(p.Online) })),
      };
    } catch {
      return null;
    }
  }
  return null;
}

// --- the swarm ---------------------------------------------------------------------------------

// `me`: { id, pub, key, name, version }; `peers`: [{ id, name, pub, host, port }]; `here()`: this PC now,
// { locked, idle } (idle: seconds since a key or the mouse); `onChange(state)`: who's where changed;
// `onPeers(peers)`: the list to save. `hosts`: the addresses to listen on.
function createSwarm({ me, peers = [], port = PORT, hosts = ['127.0.0.1'], here, onChange = () => {}, onPeers = () => {}, every = 3000, gone = 12000 }) {
  const known = new Map(peers.map((p) => [p.id, { ...p }]));
  const keys = new Map(); // id -> shared key
  const status = new Map(); // id -> { seen, locked, idle, name, at }
  const seen = new Map(); // nonces
  let pair = null; // { code, until, tries }
  let servers = [];
  let timer = null;
  let active = me.id;
  let told = null; // what onChange was last told
  let stopped = false;

  const keyFor = (peer) => {
    if (!keys.has(peer.id)) keys.set(peer.id, pairKey(me.key, peer.pub));
    return keys.get(peer.id);
  };
  const record = (p) => ({ id: p.id, name: String(p.name || p.id).slice(0, 60), pub: p.pub, host: p.host, port: p.port });
  const saved = () => onPeers([...known.values()].map(record));

  function post(host, port, path, body, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({ host, port, path, method: 'POST', timeout, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { text += c; if (text.length > MAX_BODY) req.destroy(); });
        res.on('end', () => {
          try {
            const json = JSON.parse(text);
            if (res.statusCode !== 200) reject(new SwarmError(json.error || `status ${res.statusCode}`));
            else resolve(json);
          } catch {
            reject(new SwarmError('badReply'));
          }
        });
      });
      req.on('timeout', () => req.destroy(new SwarmError('timeout')));
      req.on('error', (err) => reject(err instanceof SwarmError ? err : new SwarmError('unreachable')));
      req.end(data);
    });
  }

  // a sealed message to a peer, and its sealed answer opened
  async function send(peer, kind, body) {
    const reply = await post(peer.host, peer.port, '/swarm', seal(keyFor(peer), me.id, peer.id, kind, body));
    if (reply.from !== peer.id) throw new SwarmError('notThem');
    return open(keyFor(peer), reply, me.id, seen);
  }

  function hereNow() {
    const h = here();
    return { name: me.name, version: me.version || null, locked: Boolean(h.locked), idle: Math.max(0, Number(h.idle) || 0), active };
  }

  // what came in, sealed: its answer (sealed too)
  function onMessage(message, remote) {
    const peer = known.get(message?.from);
    if (!peer) throw new SwarmError('unknown');
    const inside = open(keyFor(peer), message, me.id, seen);
    // it's really them: where they write from is where they are now
    if (remote && remote !== peer.host) {
      peer.host = remote;
      saved();
    }
    let answer = null;
    if (inside.kind === 'here') {
      heard(peer, inside.body);
      answer = hereNow();
    } else if (inside.kind === 'introduce') {
      // a PC the one that paired with it vouches for: added (never one of ours replaced)
      for (const p of [].concat(inside.body || [])) {
        if (!p?.pub || nodeId(p.pub) !== p.id || p.id === me.id || known.has(p.id)) continue;
        known.set(p.id, record(p));
      }
      saved();
      answer = { ok: true };
    } else if (inside.kind === 'leave') {
      known.delete(peer.id);
      keys.delete(peer.id);
      status.delete(peer.id);
      saved();
      decide();
      answer = { ok: true };
    } else {
      throw new SwarmError('unknownKind');
    }
    return seal(keyFor(peer), me.id, peer.id, inside.kind, answer);
  }

  // `/swarm/pair`: the other PC, with the code shown here. It gets the rest of the swarm back.
  function onPair(body, remote) {
    if (!pair || Date.now() > pair.until) throw new SwarmError('noInvite');
    if (pair.tries >= PAIR_TRIES) throw new SwarmError('noInvite');
    const { id, pub, name, port: theirPort } = body || {};
    if (typeof pub !== 'string' || nodeId(pub) !== id || id === me.id) throw new SwarmError('badPair');
    if (!same(body.proof, proof(pair.code, 'join', pub))) {
      pair.tries += 1;
      throw new SwarmError('badCode');
    }
    const others = [...known.values()].map(record);
    const peer = record({ id, pub, name, host: remote, port: Number(theirPort) || PORT });
    known.set(id, peer);
    const reply = { id: me.id, pub: me.pub, name: me.name, proof: proof(pair.code, 'host', me.pub, pub), peers: others };
    pair = null;
    saved();
    // the ones already here learn of the new one
    for (const other of others) send(other, 'introduce', [peer]).catch(() => {});
    tick();
    return reply;
  }

  // Joining through another PC's code: { name } of that PC, or a SwarmError
  async function join(text) {
    const inv = readInvite(text);
    if (!inv) throw new SwarmError('badInvite');
    const reply = await post(inv.host, inv.port, '/swarm/pair', { id: me.id, pub: me.pub, name: me.name, port, proof: proof(inv.code, 'join', me.pub) });
    return accept(reply, inv);
  }

  function accept(reply, inv) {
    if (typeof reply.pub !== 'string' || nodeId(reply.pub) !== reply.id || reply.id === me.id) throw new SwarmError('badPair');
    if (!same(reply.proof, proof(inv.code, 'host', reply.pub, me.pub))) throw new SwarmError('badCode'); // not the PC that showed it
    known.set(reply.id, record({ id: reply.id, pub: reply.pub, name: reply.name, host: inv.host, port: inv.port }));
    for (const p of reply.peers || []) {
      if (p?.pub && nodeId(p.pub) === p.id && p.id !== me.id && !known.has(p.id)) known.set(p.id, record(p));
    }
    saved();
    tick();
    return { name: reply.name };
  }

  function heard(peer, body) {
    const now = Date.now();
    const version = typeof body?.version === 'string' ? body.version.slice(0, 40) : null;
    status.set(peer.id, { seen: now, locked: Boolean(body?.locked), idle: Math.max(0, Number(body?.idle) || 0), at: now, version });
    if (typeof body?.name === 'string' && body.name && body.name !== peer.name) {
      peer.name = body.name.slice(0, 60);
      saved();
    }
  }

  // Where you are: the unlocked PC with the freshest key or mouse, among those answering. The one
  // she's on keeps her unless another is clearly fresher (no hopping back and forth).
  function decide() {
    const now = Date.now();
    const mine = here();
    const all = [{ id: me.id, locked: Boolean(mine.locked), idle: Math.max(0, Number(mine.idle) || 0) }];
    for (const [id, s] of status) {
      if (!known.has(id) || now - s.seen > gone) continue;
      all.push({ id, locked: s.locked, idle: s.idle + (now - s.at) / 1000 });
    }
    const free = all.filter((n) => !n.locked);
    let next;
    if (!free.length) {
      next = all.some((n) => n.id === active) ? active : me.id; // nobody at any: she waits where she is (or here)
    } else {
      const best = free.reduce((a, b) => (b.idle < a.idle ? b : a));
      const current = free.find((n) => n.id === active);
      next = current && current.idle <= best.idle + 3 ? active : best.id;
    }
    active = next;
    // who's where, as Mainframe shows it: told when any of it changed
    const now2 = state();
    const sig = JSON.stringify([now2.active, now2.peers.map((p) => [p.id, p.online, p.locked])]);
    if (sig !== told) {
      told = sig;
      onChange(now2);
    }
  }

  async function tick() {
    if (stopped) return;
    await Promise.all([...known.values()].map(async (peer) => {
      try {
        const inside = await send(peer, 'here', hereNow());
        heard(peer, inside.body);
      } catch {
        // unreachable, or not answering right: gone once `gone` has passed without a word
      }
    }));
    decide();
  }

  function state() {
    const now = Date.now();
    return {
      me: { id: me.id, name: me.name },
      active,
      here: active === me.id,
      pairing: pair && pair.until > now ? { until: pair.until } : null,
      peers: [...known.values()].map((p) => {
        const s = status.get(p.id);
        const online = Boolean(s && now - s.seen <= gone);
        return { id: p.id, name: p.name, host: p.host, online, locked: online && s.locked, active: p.id === active, version: s?.version || null };
      }),
    };
  }

  function handle(req, res) {
    const reply = (code, json) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (req.method !== 'POST' || !['/swarm', '/swarm/pair'].includes(req.url)) return reply(404, { error: 'notFound' });
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      text += c;
      if (text.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(text);
        const remote = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
        reply(200, req.url === '/swarm' ? onMessage(body, remote) : onPair(body, remote));
      } catch (err) {
        reply(err instanceof SwarmError ? 403 : 400, { error: err instanceof SwarmError ? err.message : 'bad' });
      }
    });
  }

  async function start() {
    for (const host of [...new Set(hosts)]) {
      const server = http.createServer(handle);
      server.headersTimeout = 5000;
      server.requestTimeout = 8000;
      await new Promise((resolve) => {
        server.once('error', resolve); // taken, or that address is gone: the others still listen
        server.listen(port, host, resolve);
      });
      if (server.listening) servers.push(server);
    }
    timer = setInterval(tick, every);
    tick();
    return servers.length;
  }

  function stop() {
    stopped = true;
    clearInterval(timer);
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
    servers = [];
  }

  // a code for another PC to join with (shown in Mainframe), at `address` (this PC's Tailscale one)
  function startPairing(address) {
    const inv = invite(address, port);
    pair = { code: inv.code, until: inv.until, tries: 0 };
    return inv;
  }

  // a PC taken out of the swarm (it's told, if it answers)
  async function remove(id) {
    const peer = known.get(id);
    if (!peer) return;
    await send(peer, 'leave', {}).catch(() => {});
    known.delete(id);
    keys.delete(id);
    status.delete(id);
    saved();
    decide();
  }

  return { start, stop, join, startPairing, stopPairing: () => { pair = null; }, remove, state, tick, decide };
}

module.exports = { createSwarm, identity, nodeId, pairKey, seal, open, invite, readInvite, tailscale, SwarmError, PORT, hostName: () => os.hostname() };
