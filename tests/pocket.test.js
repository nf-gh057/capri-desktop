'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { webcrypto } = crypto;
const pocket = require('../src/main/pocket');
// made-up attestation chains (tests/fixtures/make-attest.js), from a root of their own, for the code below
const made = require('./fixtures/attest.json');
const CODE = 'ABCDE23456';

const { subtle } = webcrypto;
let nextPort = 47950;

// Her page on a port of its own, plain HTTP on 127.0.0.1, with who's calling set by the test (as
// Tailscale's whois would say it) and her answers made up
function page(t, extra = {}) {
  const port = nextPort++;
  const origin = `http://127.0.0.1:${port}`;
  const state = { who: { node: 'phone-1', name: 'pixel', user: 1, os: 'android' }, phones: [], asked: [] };
  const p = pocket.createPocket({
    port, origins: [origin], remember: 0, dir: path.join(__dirname, '..', 'src', 'pocket'), roots: [made.root],
    whois: async () => state.who,
    mine: (who) => who.user === 1,
    phones: () => state.phones,
    onPhones: (list) => { state.phones = list; },
    ask: async (text, { delta, order }) => {
      state.asked.push(order ? `order: ${text}` : text);
      delta('Hel');
      delta('lo');
      return { ok: true, text: 'Hello' };
    },
    history: () => [{ role: 'user', content: 'hi', at: 1 }, { role: 'assistant', content: 'hey', at: 2 }],
    labels: () => ({ pair: 'Pair' }),
    name: () => 'desk',
    pcs: () => [{ name: 'laptop', url: 'https://laptop.tail1234.ts.net:47825/', active: true }],
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
  return { jwk, sign, privateKey: keys.privateKey };
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
  it.state.who = { node: 'theirs', name: 'x', user: 2, os: 'android' }; // shared into your network from another account
  for (const url of ['/', '/pocket.js', '/api/start']) assert.equal((await it.call('GET', url)).status, 403);
  it.state.who = null; // not Tailscale at all
  assert.equal((await it.call('GET', '/')).status, 403);
});

test('her page answers on each of her addresses (Tailscale gives her name an IPv6 one too), and stops on all', async (t) => {
  const it = page(t, { host: ['127.0.0.1', '::1'] });
  assert.ok(await it.p.start());
  const port = new URL(it.origin).port;
  for (const at of ['127.0.0.1', '[::1]']) assert.equal((await fetch(`http://${at}:${port}/api/start`)).status, 200);
  it.p.stop();
  for (const at of ['127.0.0.1', '[::1]']) await assert.rejects(fetch(`http://${at}:${port}/api/start`));
});

test('a phone of yours sees the page, and pairs only with the code, while it is open', async (t) => {
  const it = page(t);
  await it.p.start();
  const res = await fetch(`${it.origin}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  const start = await it.call('GET', '/api/start');
  assert.deepEqual([start.json.paired, start.json.pairing, start.json.challenge], [false, false, null]);
  assert.equal(start.json.pcs[0].url, 'https://laptop.tail1234.ts.net:47825/'); // her page on your other PCs
  assert.equal(start.json.here, true); // she's on this one
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
  it.state.who = { node: 'tablet', name: 'tablet', user: 1, os: 'android' }; // another device of yours, with the phone's cookie
  assert.equal((await it.call('GET', '/api/history')).status, 401);
  assert.equal((await it.call('POST', '/api/send', { text: 'hi' })).status, 401);
  it.state.who = { node: 'phone-1', name: 'pixel', user: 1, os: 'android' };
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

// what a stream says until `until` is in it (or a short while has passed)
async function heard(res, until) {
  const reader = res.body.getReader();
  let got = '';
  const stop = Date.now() + 1500;
  while (!got.includes(until) && Date.now() < stop) {
    const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: null }), 300))]);
    if (chunk.value) got += new TextDecoder().decode(chunk.value);
  }
  reader.cancel().catch(() => {});
  return got;
}

test('her notes reach the page as they come, numbered by their time, the same one once', async (t) => {
  const it = await paired(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${it.origin}/api/events`, { headers: { cookie: it.cookie() }, signal: controller.signal });
  const at = Date.now();
  assert.equal(it.p.note({ id: 'a1', at, line: 'Codex needs you', project: 'capri', quote: 'Allow?' }), true);
  assert.equal(it.p.note({ id: 'a1', at, line: 'Codex needs you' }), false); // from another PC too: once
  assert.equal(it.p.note({ id: 'x', at: 'soon', line: 'no' }), false);
  assert.equal(it.p.note({ id: 'y', at, line: '' }), false);
  assert.equal(it.p.note({ id: 'z', at: at - 2 * 24 * 3600 * 1000, line: 'two days ago' }), false); // too old to be news
  const got = await heard(stream, 'event: note');
  assert.ok(got.includes(`id: ${at}\nevent: note\ndata: {"id":"a1","at":${at},"line":"Codex needs you","project":"capri","quote":"Allow?"}`));
});

test('a page back after a while gets the notes it missed, and only those', async (t) => {
  const it = await paired(t);
  const now = Date.now();
  it.p.note({ id: 'old', at: now - 3000, line: 'first' });
  it.p.note({ id: 'new', at: now - 1000, line: 'second' });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const asked = await heard(await fetch(`${it.origin}/api/events?since=${now - 2000}`, { headers: { cookie: it.cookie() }, signal: controller.signal }), 'second');
  assert.ok(asked.includes('second') && !asked.includes('first'));
  // as a browser says it, coming back on its own: the last one it got
  const back = await heard(await fetch(`${it.origin}/api/events`, { headers: { cookie: it.cookie(), 'last-event-id': String(now - 1000) }, signal: controller.signal }), 'event: note');
  assert.ok(!back.includes('event: note'));
  // a page that says nothing gets nothing old
  const fresh = await heard(await fetch(`${it.origin}/api/events`, { headers: { cookie: it.cookie() }, signal: controller.signal }), 'event: note');
  assert.ok(!fresh.includes('event: note'));
});

// her app paired (its key, `client: 'app'`) and unlocked: what it signs an order with, after a fingerprint
// her app's key as one of the made-up chains says it is: its public half, its chain, and signing with it
function appKey(which = 'good') {
  const c = made.cases[which];
  const sign = (data) => crypto.sign('sha256', Buffer.from(data), { key: c.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { jwk: c.jwk, chain: c.chain, sign: async (challenge) => sign(pocket.signed(challenge)), signRaw: sign };
}

async function appPaired(t) {
  const it = page(t);
  await it.p.start();
  const key = appKey();
  const pair = await it.call('POST', '/api/pair', { code: it.p.startPairing(CODE).code, key: key.jwk, client: 'app', attestation: key.chain });
  await it.call('POST', '/api/hello', { challenge: pair.json.challenge, sig: await key.sign(pair.json.challenge) });
  const signOrder = async (challenge, text) => key.signRaw(pocket.orderSigned(challenge, text));
  return { ...it, key, signOrder };
}

test('her app pairs only with a key Google\'s attestation vouches for, made for this pairing', async (t) => {
  const it = page(t);
  await it.p.start();
  const tries = [
    [{ key: appKey().jwk }, 'notAttested:noChain'],
    [{ key: appKey('software').jwk, attestation: appKey('software').chain }, 'notAttested:software'],
    [{ key: appKey('noAuth').jwk, attestation: appKey('noAuth').chain }, 'notAttested:noFingerprint'],
    [{ key: appKey('forAWhile').jwk, attestation: appKey('forAWhile').chain }, 'notAttested:notEachTime'],
    [{ key: appKey('otherChallenge').jwk, attestation: appKey('otherChallenge').chain }, 'notAttested:otherChallenge'],
    [{ key: appKey('software').jwk, attestation: appKey().chain }, 'notAttested:otherKey'],
  ];
  for (const [body, error] of tries) {
    const res = await it.call('POST', '/api/pair', { code: it.p.startPairing(CODE).code, client: 'app', ...body });
    assert.equal(res.json.error, error);
  }
  assert.equal(it.state.phones.length, 0);
  const ok = await it.call('POST', '/api/pair', { code: it.p.startPairing(CODE).code, client: 'app', key: appKey().jwk, attestation: appKey().chain });
  assert.equal(ok.status, 200);
  assert.deepEqual(it.state.phones[0].attestation, appKey().chain);
});

test('no orders from her app\'s key without its attestation (as an older pairing has it)', async (t) => {
  const it = await appPaired(t);
  delete it.state.phones[0].attestation;
  it.state.phones[0] = { ...it.state.phones[0], key: { ...it.state.phones[0].key } }; // (checked again, as a new record)
  const { challenge } = (await it.call('GET', '/api/challenge')).json;
  assert.equal((await it.call('POST', '/api/order', { text: 'x', challenge, sig: await it.signOrder(challenge, 'x') })).json.error, 'notAttested');
});

test('an order from her app: signed on its own, for that order, once', async (t) => {
  const it = await appPaired(t);
  let { challenge } = (await it.call('GET', '/api/challenge')).json;
  // signed for another order: refused, and its challenge spent
  const wrong = await it.call('POST', '/api/order', { text: 'open Spotify', challenge, sig: await it.signOrder(challenge, 'delete everything') });
  assert.equal(wrong.json.error, 'badSig');
  assert.equal((await it.call('POST', '/api/order', { text: 'open Spotify', challenge, sig: await it.signOrder(challenge, 'open Spotify') })).json.error, 'noChallenge');
  ({ challenge } = (await it.call('GET', '/api/challenge')).json);
  const ok = await it.call('POST', '/api/order', { text: 'open Spotify', challenge, sig: await it.signOrder(challenge, 'open Spotify') });
  assert.equal(ok.status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(it.state.asked, ['order: open Spotify']);
  // a session's challenge isn't an order's, and an order's isn't a session's
  const { challenge: hello } = (await it.call('GET', '/api/start')).json;
  assert.equal((await it.call('POST', '/api/order', { text: 'x', challenge: hello, sig: await it.signOrder(hello, 'x') })).json.error, 'noChallenge');
  ({ challenge } = (await it.call('GET', '/api/challenge')).json);
  assert.equal((await it.call('POST', '/api/hello', { challenge, sig: await it.key.sign(challenge) })).json.error, 'noChallenge');
});

test('no orders from a page in a browser', async (t) => {
  const it = await paired(t); // paired as her page is: a browser's key
  const { challenge } = (await it.call('GET', '/api/challenge')).json;
  const sig = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, it.key.privateKey, pocket.orderSigned(challenge, 'x'))).toString('base64url');
  assert.equal((await it.call('POST', '/api/order', { text: 'x', challenge, sig })).json.error, 'notApp');
  it.setCookie('');
  assert.equal((await it.call('GET', '/api/challenge')).status, 401); // and without a session, no challenge for it
  assert.deepEqual(it.state.asked, []);
});

test('her app on another PC sends an order here directly: signed, no session, her answer back with it', async (t) => {
  const it = await appPaired(t);
  it.setCookie(''); // her app's session is on another PC
  const { challenge } = (await it.call('GET', '/api/challenge')).json;
  const done = await it.call('POST', '/api/order', { text: 'open Chrome', challenge, sig: await it.signOrder(challenge, 'open Chrome') });
  assert.equal(done.status, 200);
  assert.deepEqual([done.json.ok, done.json.text], [true, 'Hello']);
  assert.deepEqual(it.state.asked, ['order: open Chrome']);
  const again = await it.call('POST', '/api/order', { text: 'open Chrome', challenge, sig: await it.signOrder(challenge, 'open Chrome') });
  assert.equal(again.json.error, 'noChallenge'); // played again: no
});

test('her app\'s listening key: given once unlocked, it hears her notes and nothing else', async (t) => {
  const it = await appPaired(t);
  const listen = await phoneKey();
  const full = it.cookie();
  it.setCookie('');
  assert.equal((await it.call('POST', '/api/listen-key', { key: listen.jwk })).status, 401); // only from a session your fingerprint opened
  it.setCookie(full);
  assert.equal((await it.call('POST', '/api/listen-key', { key: listen.jwk })).status, 200);
  assert.ok(it.state.phones[0].listen && !('d' in it.state.phones[0].listen));
  it.setCookie('');
  const { challenge } = (await it.call('GET', '/api/listen')).json;
  assert.equal((await it.call('POST', '/api/listen', { challenge, sig: await it.key.sign(challenge) })).json.error, 'badSig'); // not the listening key
  const { challenge: c2 } = (await it.call('GET', '/api/listen')).json;
  const sig = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, listen.privateKey, pocket.listenSigned(c2))).toString('base64url');
  assert.equal((await it.call('POST', '/api/listen', { challenge: c2, sig })).status, 200);
  // a notes-only session: no chat, no history, no orders' challenges for it to read her answers with
  assert.equal((await it.call('GET', '/api/history')).status, 401);
  assert.equal((await it.call('POST', '/api/send', { text: 'hi' })).status, 401);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${it.origin}/api/events`, { headers: { cookie: it.cookie() }, signal: controller.signal });
  assert.equal(stream.status, 200);
  it.p.note({ id: 'n9', at: Date.now(), line: 'Codex is done' });
  assert.match(await heard(stream, 'event: note'), /"line":"Codex is done"/);
});

test('which PC an order is for: asked with a session only', async (t) => {
  const it = await appPaired(t);
  assert.deepEqual((await it.call('POST', '/api/route', { text: 'Chrome' })).json, { here: true });
  it.setCookie('');
  assert.equal((await it.call('POST', '/api/route', { text: 'Chrome' })).status, 401);
});

test('a session that ends (the app locked) ends its stream too', async (t) => {
  const it = await paired(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${it.origin}/api/events`, { headers: { cookie: it.cookie() }, signal: controller.signal });
  const reader = stream.body.getReader();
  await reader.read(); // her hello
  assert.equal((await it.call('POST', '/api/bye', {})).status, 200);
  const next = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r('still open'), 1000))]);
  assert.equal(next.done, true);
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

test('a PC of yours gets nothing either: phones and tablets only', async (t) => {
  const it = page(t);
  await it.p.start();
  it.state.who = { node: 'laptop', name: 'laptop', user: 1, os: 'windows' };
  assert.equal((await it.call('GET', '/')).status, 403);
  assert.equal((await it.call('GET', '/api/start')).status, 403);
  it.state.who = { node: 'ipad', name: 'ipad', user: 1, os: 'iOS' };
  assert.equal((await it.call('GET', '/api/start')).status, 200);
});

test('a phone keeps a key for each place it paired (a page on each PC, her app), and any of them opens a session', async (t) => {
  const it = page(t);
  await it.p.start();
  const browser = await phoneKey();
  const app = appKey();
  const elsewhere = await phoneKey();
  await it.call('POST', '/api/pair', { code: it.p.startPairing().code, key: browser.jwk });
  await it.call('POST', '/api/pair', { code: it.p.startPairing(CODE).code, key: app.jwk, client: 'app', attestation: app.chain });
  assert.deepEqual(it.state.phones.map((p) => p.via), [it.origin, 'app']);
  // as another PC of her swarm passes it on: the same phone, paired on that PC's page
  it.state.phones.push({ ...it.state.phones[0], key: pocket.publicKey(elsewhere.jwk), via: 'https://laptop.tail1234.ts.net:47825' });
  for (const key of [browser, app, elsewhere]) {
    const { challenge } = (await it.call('GET', '/api/start')).json;
    assert.equal((await it.call('POST', '/api/hello', { challenge, sig: await key.sign(challenge) })).status, 200);
  }
  // this page's key lost, paired again: it takes the old one's place, the others stay
  const again = await phoneKey();
  await it.call('POST', '/api/pair', { code: it.p.startPairing().code, key: again.jwk });
  assert.equal(it.state.phones.length, 3);
  const { challenge } = (await it.call('GET', '/api/start')).json;
  assert.equal((await it.call('POST', '/api/hello', { challenge, sig: await browser.sign(challenge) })).json.error, 'badSig');
});

test('a phone key from another PC of her swarm: taken only in the shape it is kept', async () => {
  const { jwk } = await phoneKey();
  assert.deepEqual(pocket.phoneRecord({ id: 'n1', name: 'pixel', key: jwk, at: 5, via: 'app', extra: 1 }),
    { id: 'n1', name: 'pixel', key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, at: 5, via: 'app' });
  assert.equal(pocket.phoneRecord({ id: 'n1', key: { ...jwk, d: 'x' }, at: 5 }), null);
  assert.equal(pocket.phoneRecord({ id: '', key: jwk, at: 5 }), null);
  assert.equal(pocket.phoneRecord({ id: 'n1', key: jwk }), null);
});

test('a phone key as the page sends it: only P-256, only its public half', () => {
  assert.equal(pocket.publicKey({ kty: 'RSA', n: 'x', e: 'AQAB' }), null);
  assert.equal(pocket.publicKey({ kty: 'EC', crv: 'P-384', x: 'a', y: 'b' }), null);
  assert.equal(pocket.publicKey({ kty: 'EC', crv: 'P-256', x: 'not', y: 'apoint' }), null);
});
