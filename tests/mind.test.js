'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMind, valid } = require('../src/main/mind');

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';

// one round of swapping between two minds, as her swarm does it (each pulls what it hasn't seen)
function swap(x, y) {
  for (let i = 0; i < 20; i++) {
    const a = y.since(x.vv(), 300);
    x.merge(a.items);
    const b = x.since(y.vv(), 300);
    y.merge(b.items);
    if (!a.more && !b.more) return;
  }
}
const view = (m) => JSON.stringify(Object.entries(m.state().items).sort().map(([k, e]) => [k, e.v, Boolean(e.del)]));

test('writing: a change is an entry; the same value again is nothing', () => {
  const m = createMind({ me: A });
  assert.equal(m.write('name', 'Sam', { now: 10 }), true);
  assert.equal(m.write('name', 'Sam', { now: 20 }), false);
  assert.equal(m.write('name', 'Luk', { now: 15 }), true);
  assert.equal(m.get('name'), 'Luk');
  assert.ok(m.state().items.name.at > 10); // never older than what it replaces, whatever the clock says
  assert.equal(m.write('memo:x', null, { del: true }), false); // nothing to remove
  assert.deepEqual(m.vv(), { [A]: 2 });
});

test('the newer entry wins, the same on every PC, whatever order they meet in', () => {
  const a = createMind({ me: A });
  const b = createMind({ me: B });
  const c = createMind({ me: C });
  a.write('persona', 'calm', { now: 100 });
  b.write('persona', 'wild', { now: 200 });
  c.write('persona', 'shy', { now: 150 });
  a.write('memo:1', 'likes tea', { now: 120 });
  c.write('memo:2', 'has a cat', { now: 130 });
  swap(a, b);
  swap(b, c);
  swap(c, a);
  swap(a, b);
  assert.equal(view(a), view(b));
  assert.equal(view(b), view(c));
  assert.equal(a.get('persona'), 'wild');
  assert.deepEqual(a.list('memo:').map((e) => e.v).sort(), ['has a cat', 'likes tea']);
});

test('an island: changes on both sides while apart, all of them there once it is back', () => {
  const desk = createMind({ me: A });
  const laptop = createMind({ me: B });
  desk.write('chat:1', { role: 'user', content: 'hi' }, { now: 1 });
  swap(desk, laptop);
  // the laptop goes offline; both go on
  laptop.write('chat:2', { role: 'user', content: 'offline here' }, { now: 10 });
  laptop.write('memo:tea', 'likes tea', { now: 11 });
  desk.write('chat:3', { role: 'user', content: 'at the desk' }, { now: 12 });
  desk.write('memo:tea', null, { del: true, now: 5 }); // never there: nothing to remove
  desk.write('chat:1', null, { del: true, now: 13 });
  swap(desk, laptop);
  assert.equal(view(desk), view(laptop));
  assert.deepEqual(desk.list('chat:').map((e) => e.key).sort(), ['chat:2', 'chat:3']);
  assert.equal(laptop.get('memo:tea'), 'likes tea');
});

test('removed stays removed: a PC that still had it does not bring it back', () => {
  const a = createMind({ me: A });
  const b = createMind({ me: B });
  a.write('rem:7', { text: 'call mum' }, { now: 1 });
  swap(a, b);
  b.write('rem:7', null, { del: true, now: 2 });
  swap(a, b);
  swap(b, a);
  assert.equal(a.get('rem:7'), undefined);
  assert.equal(b.get('rem:7'), undefined);
  assert.equal(a.has('rem:7'), true); // its tombstone
});

test('only what the other has not seen goes, in pages; pruned old entries do not come back', () => {
  const a = createMind({ me: A });
  const b = createMind({ me: B });
  for (let i = 0; i < 40; i++) a.write(`chat:${String(i).padStart(2, '0')}`, { content: 'x'.repeat(50) }, { now: i + 1 });
  const first = a.since(b.vv(), 300);
  assert.ok(first.more);
  assert.ok(first.items.length < 40);
  swap(a, b);
  assert.equal(b.list('chat:').length, 40);
  assert.deepEqual(a.since(b.vv()).items, []); // all seen
  b.prune('chat:', 10);
  assert.equal(b.list('chat:').length, 10);
  swap(a, b);
  assert.equal(b.list('chat:').length, 10); // seen once: not sent again
  // what a PC saved comes back as it was
  const again = createMind({ me: B, state: JSON.parse(JSON.stringify(b.state())) });
  assert.equal(view(again), view(b));
  assert.equal(again.write('name', 'x'), true);
  assert.equal(again.vv()[B], (b.vv()[B] || 0) + 1);
});

test('what does not look like an entry is left out', () => {
  const m = createMind({ me: A });
  const good = { key: 'name', v: 'x', at: 1, by: B, seq: 1 };
  assert.equal(valid(good), true);
  for (const bad of [
    { ...good, by: 'nope' }, { ...good, seq: 0 }, { ...good, key: 'k'.repeat(200) }, { ...good, v: 'x'.repeat(20000) },
    { ...good, del: true }, { ...good, del: 'yes' }, null, { ...good, at: 'now' },
  ]) assert.equal(valid(bad), false);
  assert.deepEqual(m.merge([good, { ...good, by: 'nope' }, 'junk']), ['name']);
});
