'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const swarm = require('../src/main/swarm');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A Capri on this PC, on a port of its own, with how its PC is doing set by the test
function node(t, name, port, extra = {}) {
  const me = { ...swarm.identity(), name };
  const pc = { locked: false, idle: 100 };
  const changes = [];
  let peers = [];
  const s = swarm.createSwarm({
    me, port, hosts: ['127.0.0.1'], here: () => pc, every: 100, gone: 600,
    onChange: (state) => changes.push(state.active), onPeers: (list) => { peers = list; }, ...extra,
  });
  t.after(() => s.stop());
  return { me, pc, s, changes, peers: () => peers };
}

test('sealed for one PC: opened by it only, untouched, once, and not too old', () => {
  const a = swarm.identity();
  const b = swarm.identity();
  const c = swarm.identity();
  const ab = swarm.pairKey(a.key, b.pub);
  assert.deepEqual(ab, swarm.pairKey(b.key, a.pub)); // the same on both sides
  const msg = swarm.seal(ab, a.id, b.id, 'here', { locked: false, idle: 3 });
  assert.ok(!JSON.stringify(msg).includes('idle')); // what's inside doesn't show
  const seen = new Map();
  assert.deepEqual(swarm.open(ab, msg, b.id, seen).body, { locked: false, idle: 3 });
  assert.throws(() => swarm.open(ab, msg, b.id, seen), { message: 'replayed' });
  assert.throws(() => swarm.open(ab, msg, c.id, new Map()), { message: 'notForUs' });
  assert.throws(() => swarm.open(swarm.pairKey(c.key, a.pub), { ...msg, to: c.id }, c.id, new Map()), { message: 'tampered' });
  const flipped = Buffer.from(msg.data, 'base64');
  flipped[3] ^= 1;
  assert.throws(() => swarm.open(ab, { ...msg, data: flipped.toString('base64') }, b.id, new Map()), { message: 'tampered' });
  assert.throws(() => swarm.open(ab, { ...msg, from: c.id }, b.id, new Map()), { message: 'tampered' }); // its sender is sealed in
  const old = swarm.seal(ab, a.id, b.id, 'here', {}, Date.now() - 10 * 60 * 1000);
  assert.throws(() => swarm.open(ab, old, b.id, new Map()), { message: 'stale' });
});

test('an invite is one line: address, port and code; anything else is no invite', () => {
  const inv = swarm.invite('100.64.0.7', 47824);
  assert.match(inv.text, /^100\.64\.0\.7:47824\/[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.deepEqual(swarm.readInvite(` ${inv.text.toLowerCase()} `), { host: '100.64.0.7', port: 47824, code: inv.code });
  assert.deepEqual(swarm.readInvite('my-pc.tail1234.ts.net:47824/ABCDE-FGHJK'), { host: 'my-pc.tail1234.ts.net', port: 47824, code: 'ABCDEFGHJK' });
  for (const bad of ['', 'ABCDE-FGHJK', '100.64.0.7/ABCDE-FGHJK', '100.64.0.7:47824/ABC', null]) assert.equal(swarm.readInvite(bad), null);
});

test('pairing: a wrong code is refused, the right one links both, and a third learns of the second', async (t) => {
  const a = node(t, 'desk', 49211);
  const b = node(t, 'laptop', 49212);
  const c = node(t, 'tablet', 49213);
  await Promise.all([a.s.start(), b.s.start(), c.s.start()]);
  const inv = a.s.startPairing('127.0.0.1');
  const wrong = inv.text.replace(/\/.*$/, '/AAAAA-AAAAA');
  await assert.rejects(b.s.join(wrong), { message: 'badCode' });
  assert.deepEqual(await b.s.join(inv.text), { name: 'desk' });
  await assert.rejects(c.s.join(inv.text), { message: 'noInvite' }); // a code works once
  assert.deepEqual(a.peers().map((p) => p.name), ['laptop']);
  assert.deepEqual(b.peers().map((p) => p.name), ['desk']);
  const inv2 = b.s.startPairing('127.0.0.1');
  await c.s.join(inv2.text);
  await wait(300);
  assert.deepEqual(a.peers().map((p) => p.name).sort(), ['laptop', 'tablet']); // introduced by the laptop
  assert.deepEqual(c.peers().map((p) => p.name).sort(), ['desk', 'laptop']);
  assert.ok(c.s.state().peers.every((p) => p.online));
});

test('too many wrong codes and the invite stops working', async (t) => {
  const a = node(t, 'desk', 49221);
  const b = node(t, 'laptop', 49222);
  await Promise.all([a.s.start(), b.s.start()]);
  const inv = a.s.startPairing('127.0.0.1');
  for (let i = 0; i < 5; i++) await assert.rejects(b.s.join(inv.text.replace(/\/.*$/, '/AAAAA-AAAAA')), { message: 'badCode' });
  await assert.rejects(b.s.join(inv.text), { message: 'noInvite' });
});

test('she is on the PC you use: unlocked, freshest; a locked or unreachable one is not it', async (t) => {
  const a = node(t, 'desk', 49231);
  const b = node(t, 'laptop', 49232);
  await Promise.all([a.s.start(), b.s.start()]);
  await b.s.join(a.s.startPairing('127.0.0.1').text);
  a.pc.idle = 2;
  b.pc.idle = 50;
  await wait(400);
  assert.equal(a.s.state().here, true);
  assert.equal(b.s.state().here, false);
  // you sit down at the laptop
  b.pc.idle = 0;
  a.pc.idle = 30;
  await wait(400);
  assert.equal(b.s.state().here, true);
  assert.equal(a.s.state().here, false);
  // a little fresher elsewhere isn't enough to hop back
  a.pc.idle = 0;
  b.pc.idle = 2;
  await wait(400);
  assert.equal(b.s.state().here, true);
  // the laptop locked: back at the desk
  b.pc.locked = true;
  await wait(400);
  assert.equal(a.s.state().here, true);
  assert.equal(a.s.state().peers[0].locked, true);
  // the laptop unlocked and used, then gone from the network: the desk has her again
  b.pc.locked = false;
  b.pc.idle = 0;
  a.pc.idle = 40;
  await wait(400);
  assert.equal(a.s.state().here, false);
  b.s.stop();
  await wait(900);
  assert.equal(a.s.state().here, true);
  assert.equal(a.s.state().peers[0].online, false);
});

test('only a paired PC is listened to; a removed one is told and forgotten', async (t) => {
  const a = node(t, 'desk', 49241);
  const b = node(t, 'laptop', 49242);
  await Promise.all([a.s.start(), b.s.start()]);
  // a stranger with its own key: refused
  const stranger = swarm.identity();
  const res = await fetch('http://127.0.0.1:49241/swarm', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(swarm.seal(swarm.pairKey(stranger.key, a.me.pub), stranger.id, a.me.id, 'here', {})),
  });
  assert.equal(res.status, 403);
  await b.s.join(a.s.startPairing('127.0.0.1').text);
  await a.s.remove(b.me.id);
  await wait(200);
  assert.deepEqual(a.peers(), []);
  assert.deepEqual(b.peers(), []);
});

test('what an agent does on the PC you are not at reaches the one you are at, cut down to what she reads', async (t) => {
  const heard = [];
  const a = node(t, 'desk', 49251, { onEvent: (peer, evt) => heard.push({ from: peer.name, evt }) });
  const b = node(t, 'laptop', 49252);
  await Promise.all([a.s.start(), b.s.start()]);
  await b.s.join(a.s.startPairing('127.0.0.1').text);
  a.pc.idle = 1;
  b.pc.idle = 300;
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(b.s.state().here, false);
  const sent = await b.s.forward({
    hook_event_name: 'Stop', session_id: 'codex:abc', cwd: 'C:/code/capri', agent: 'codex',
    last_assistant_message: 'x'.repeat(5000), tool_response: { big: 'y'.repeat(9000) }, demo: true,
    tool_input: { file_path: 'C:/code/capri/a.js', content: 'z'.repeat(1000), nested: { deep: 1 } },
  });
  assert.equal(sent, true);
  assert.equal(heard.length, 1);
  const { from, evt } = heard[0];
  assert.equal(from, 'laptop');
  assert.equal(evt.hook_event_name, 'Stop');
  assert.equal(evt.agent, 'codex');
  assert.equal(evt.last_assistant_message.length, 2000);
  assert.equal(evt.tool_response, undefined);
  assert.equal(evt.demo, undefined);
  assert.deepEqual(Object.keys(evt.tool_input), ['file_path', 'content']);
  assert.equal(evt.tool_input.content.length, 300);
  // her demo's showcase, or not an event at all: nothing goes
  assert.equal(await b.s.forward({ hook_event_name: 'CapriShowcase' }), false);
  assert.equal(await b.s.forward({ nope: 1 }), false);
  // the PC you're at keeps its own events
  assert.equal(await a.s.forward({ hook_event_name: 'Stop' }), false);
  assert.equal(heard.length, 1);
});

test('her mind goes along the swarm: an island catches up when it is back, and the others with it', async (t) => {
  const { createMind } = require('../src/main/mind');
  const ida = swarm.identity();
  const idb = swarm.identity();
  const minds = { a: createMind({ me: ida.id }), b: createMind({ me: idb.id }) };
  const told = [];
  const make = (id, name, port, m) => swarm.createSwarm({
    me: { ...id, name }, port, hosts: ['127.0.0.1'], here: () => ({ locked: false, idle: 5 }), every: 100, gone: 600,
    mind: m, onMind: (keys, peer) => told.push([name, peer.name, keys]), onPeers: (p) => { peersOf[name] = p; },
  });
  const peersOf = {};
  const a = make(ida, 'desk', 49261, minds.a);
  let b = make(idb, 'laptop', 49262, minds.b);
  t.after(() => { a.stop(); b.stop(); });
  await Promise.all([a.start(), b.start()]);
  await b.join(a.startPairing('127.0.0.1').text);
  minds.a.write('name', 'Luke');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(minds.b.get('name'), 'Luke');
  // the laptop drops off the network; both go on
  b.stop();
  minds.b.write('memo:tea', 'likes tea');
  minds.a.write('persona', 'calm');
  // back, with the pairing it saved: nothing to pair again
  const saved = peersOf.laptop;
  b = swarm.createSwarm({
    me: { ...idb, name: 'laptop' }, peers: saved, port: 49262, hosts: ['127.0.0.1'], here: () => ({ locked: false, idle: 5 }),
    every: 100, gone: 600, mind: minds.b, onMind: (keys, peer) => told.push(['laptop', peer.name, keys]),
  });
  await b.start();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(minds.a.get('memo:tea'), 'likes tea');
  assert.equal(minds.b.get('persona'), 'calm');
  assert.ok(told.some(([who, from, keys]) => who === 'laptop' && from === 'desk' && keys.includes('persona')));
});

test('on Tailscale, a device of yours joins with a click; one that is not yours does not', async (t) => {
  const yours = new Set(['127.0.0.1']); // stands for "the same Tailscale account"
  const joined = [];
  const a = node(t, 'desk', 49271, { trust: async (address) => yours.has(address), onJoined: (p) => joined.push(p.name) });
  const b = node(t, 'laptop', 49272, { trust: async (address) => yours.has(address) });
  const c = node(t, 'tablet', 49273, { trust: async (address) => yours.has(address) });
  await Promise.all([a.s.start(), b.s.start(), c.s.start()]);
  // found: the Capris on the addresses looked at, not already in her swarm, not itself
  const found = await b.s.look([{ host: '127.0.0.1', port: 49271 }, { host: '127.0.0.1', port: 49272 }, { host: '127.0.0.1', port: 49299 }]);
  assert.deepEqual(found.map((f) => f.name), ['desk']);
  assert.deepEqual(await b.s.joinTailnet('127.0.0.1', 49271), { name: 'desk' });
  assert.deepEqual(joined, ['laptop']);
  assert.deepEqual(a.peers().map((p) => p.name), ['laptop']);
  assert.deepEqual(await b.s.look([{ host: '127.0.0.1', port: 49271 }]), []); // already in it
  // the tablet joins the desk: the laptop learns of it
  await c.s.joinTailnet('127.0.0.1', 49271);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(b.peers().map((p) => p.name).sort(), ['desk', 'tablet']);
  // not yours: refused on both sides
  yours.clear();
  const d = node(t, 'stranger', 49274, { trust: async () => true });
  await d.s.start();
  await assert.rejects(d.s.joinTailnet('127.0.0.1', 49271), { message: 'notYours' }); // the desk says no
  await assert.rejects(b.s.joinTailnet('127.0.0.1', 49274), { message: 'notYours' }); // the laptop won't even ask
  assert.equal(a.peers().length, 2);
});
