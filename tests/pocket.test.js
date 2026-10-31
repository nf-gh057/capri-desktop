'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const pocket = require('../src/main/pocket');

const { subtle } = webcrypto;
let nextPort = 47950;

// Her page on a port of its own, plain HTTP on 127.0.0.1, with who's calling set by the test (as
// Tailscale's whois would say it) and her answers made up
function page(t, extra = {}) {
  const port = nextPort++;
  const origin = `http://127.0.0.1:${port}`;
  const state = { who: { node: 'phone-1', name: 'pixel', user: 1 }, phones: [], asked: [] };
  const p = pocket.createPocket({
    port, origins: [origin], remember: 0, dir: path.join(__dirname, '..', 'src', 'pocket'),
    whois: async () => state.who,
    mine: (who) => who.user === 1,
    phones: () => state.phones,
    onPhones: (list) => { state.phones = list; },
    ask: async (text, { delta }) => {
      state.asked.push(text);
      delta('Hel');
      delta('lo');
      return { ok: true, text: 'Hello' };
    },
    history: () => [{ role: 'user', content: 'hi', at: 1 }, { role: 'assistant', content: 'hey', at: 2 }],
    labels: () => ({ pair: 'Pair' }),
    name: () => 'desk',
    ...extra,
  });
  t.after(() => p.stop());
  let cookie = '';
  // as the page asks: its own origin, JSON, and the cookie it was given
  async function call(method, url, body, { from = origin, keep = true } = {}) {
    const res = await fetch(`${origin}${url}`, {
      method,
      headers: { ...(body && { 'content-type': 'application/json' }), ...(from && { origin: from }), ...(cookie && { cookie }) },
      body: body && JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set && keep) cookie = set.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }
  return { p, state, origin, call, setCookie: (c) => { cookie = c; }, cookie: () => cookie };
}

// a phone's key, made as its browser makes it, and its signature over a challenge
async function phoneKey() {
  const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const jwk = await subtle.exportKey('jwk', keys.publicKey);
  const sign = async (challenge) => Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, pocket.signed(challenge))).toString('base64url');
  return { jwk, sign };
}

async function paired(t) {
  const it = page(t);
  assert.ok(await it.p.start());
  const key = await phoneKey();
  const { code } = it.p.startPairing();
  const pair = await it.call('POST', '/api/pair', { code, key: key.jwk });
  assert.equal(pair.status, 200);
  const hello = await it.call('POST', '/api/hello', { challenge: pair.json.challenge, sig: await key.sign(pair.json.challenge) });
  assert.equal(hello.status, 200);
  return { ...it, key };
}

test('a device that is not yours gets nothing, not even the page', async (t) => {
  const it = page(t);
  await it.p.start();
  it.state.who = { node: 'theirs', name: 'x', user: 2 }; // shared into your network from another account
  for (const url of ['/', '/pocket.js', '/api/start']) assert.equal((await it.call('GET', url)).status, 403);
  it.state.who = null; // not Tailscale at all
  assert.equal((await it.call('GET', '/')).status, 403);
});

test('a phone of yours sees the page, and pairs only with the code, while it is open', async (t) => {
  const it = page(t);
  await it.p.start();
  const res = await fetch(`${it.origin}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  const start = await it.call('GET', '/api/start');
  assert.deepEqual([start.json.paired, start.json.pairing, start.json.challenge], [false, false, null]);
  const key = await phoneKey();
  assert.equal((await it.call('POST', '/api/pair', { code: 'AAAAAAAAAA', key: key.jwk })).json.error, 'noPairing');
  const { code, text } = it.p.startPairing();
  assert.match(text, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal((await it.call('POST', '/api/pair', { code, key: { ...key.jwk, d: 'secret' } })).json.error, 'badKey'); // a private key: never
  assert.equal((await it.call('POST', '/api/pair', { code: 'BBBBBBBBBB', key: key.jwk })).json.error, 'badCode');
  const ok = await it.call('POST', '/api/pair', { code: text.toLowerCase(), key: key.jwk }); // typed as it's shown, any case
  assert.equal(ok.status, 200);
  assert.equal(it.state.phones.length, 1);
  assert.equal(it.state.phones[0].id, 'phone-1');
  assert.ok(!('d' in it.state.phones[0].key));
  assert.equal((await it.call('POST', '/api/pair', { code, key: key.jwk })).json.error, 'noPairing'); // used once
});

test('wrong codes close the pairing', async (t) => {
  const it = page(t);
  await it.p.start();
  const key = await phoneKey();
  const { code } = it.p.startPairing();
  for (let i = 0; i < pocket.PAIR_TRIES; i++) await it.call('POST', '/api/pair', { code: 'CCCCCCCCCC', key: key.jwk });
  assert.equal(it.p.pairing(), false);
  assert.equal((await it.call('POST', '/api/pair', { code, key: key.jwk })).json.error, 'noPairing');
});

test('a session only for the key that paired, a challenge only once', async (t) => {
  const it = page(t);
  await it.p.start();
  const key = await phoneKey();
  const other = await phoneKey();
  const { code } = it.p.startPairing();
  await it.call('POST', '/api/pair', { code, key: key.jwk });
  let { challenge } = (await it.call('GET', '/api/start')).json;
  assert.equal((await it.call('POST', '/api/hello', { challenge, sig: await other.sign(challenge) })).json.error, 'badSig');
  assert.equal((await it.call('POST', '/api/hello', { challenge, sig: await key.sign(challenge) })).json.error, 'noChallenge'); // spent
  ({ challenge } = (await it.call('GET', '/api/start')).json);
  const hello = await it.call('POST', '/api/hello', { challenge, sig: await key.sign(challenge) });
  assert.equal(hello.status, 200);
  assert.match(it.cookie(), /^capri_pocket=/);
  assert.equal((await it.call('GET', '/api/history')).json.history.length, 2);
});

test('the cookie alone opens nothing: not on another device, not once the phone is unpaired', async (t) => {
  const it = await paired(t);
  assert.equal((await it.call('GET', '/api/history')).status, 200);
  it.state.who = { node: 'laptop', name: 'laptop', user: 1 }; // another device of yours, with the phone's cookie
  assert.equal((await it.call('GET', '/api/history')).status, 401);
  assert.equal((await it.call('POST', '/api/send', { text: 'hi' })).status, 401);
  it.state.who = { node: 'phone-1', name: 'pixel', user: 1 };
  it.state.phones = []; // unpaired in Mainframe
  assert.equal((await it.call('GET', '/api/history')).status, 401);
});

test('asked by the page only: its own origin, and JSON', async (t) => {
  const it = await paired(t);
  assert.equal((await it.call('POST', '/api/send', { text: 'hi' }, { from: 'https://evil.example' })).json.error, 'origin');
  assert.equal((await it.call('POST', '/api/send', { text: 'hi' }, { from: null })).json.error, 'origin');
  const plain = await fetch(`${it.origin}/api/send`, { method: 'POST', headers: { origin: it.origin, cookie: it.cookie(), 'content-type': 'text/plain' }, body: '{"text":"hi"}' });
  assert.equal(plain.status, 403);
  assert.deepEqual(it.state.asked, []);
});

test('your message goes to her, and her answer comes back on the stream as she writes it', async (t) => {
  const it = await paired(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${it.origin}/api/events`, { headers: { cookie: it.cookie() }, signal: controller.signal });
  assert.equal(stream.status, 200);
  const reader = stream.body.getReader();
  const sent = await it.call('POST', '/api/send', { text: '  how are you?  ' });
  assert.equal(sent.status, 200);
  let got = '';
  while (!got.includes('event: answer')) got += new TextDecoder().decode((await reader.read()).value);
  assert.deepEqual(it.state.asked, ['how are you?']);
  assert.match(got, /event: delta\ndata: .*"text":"Hel"/);
  assert.match(got, new RegExp(`event: answer\\ndata: \\{"id":"${sent.json.id}","ok":true,"text":"Hello"\\}`));
  assert.equal((await it.call('POST', '/api/send', { text: 'x'.repeat(pocket.MAX_TEXT + 1) })).json.error, 'badText');
});

test('no stream without a session', async (t) => {
  const it = page(t);
  await it.p.start();
  assert.equal((await fetch(`${it.origin}/api/events`)).status, 401);
});

test('installable as an app: every icon its manifest lists is there, at the size it says', async (t) => {
  const it = page(t);
  await it.p.start();
  const manifest = await (await fetch(`${it.origin}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512')); // what Chrome asks for to install her
  for (const icon of manifest.icons) {
    const res = await fetch(`${it.origin}${icon.src}`);
    assert.equal(res.status, 200, icon.src);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await res.arrayBuffer());
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes); // its width and height, from the PNG header
  }
});

test('a phone key as the page sends it: only P-256, only its public half', () => {
  assert.equal(pocket.publicKey({ kty: 'RSA', n: 'x', e: 'AQAB' }), null);
  assert.equal(pocket.publicKey({ kty: 'EC', crv: 'P-384', x: 'a', y: 'b' }), null);
  assert.equal(pocket.publicKey({ kty: 'EC', crv: 'P-256', x: 'not', y: 'apoint' }), null);
});
