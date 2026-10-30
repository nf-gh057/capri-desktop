'use strict';

// Her shared mind (her swarm, stage 3): what one Capri knows on all your PCs, kept as entries
// key -> value, each with when it was written, by which PC, and that PC's running number for it.
// Two PCs swap only what the other hasn't seen (by those numbers: a version vector), so a PC that was
// on its own for a while (no network: an island) catches up as soon as it's back, and the others with
// it. A newer entry wins over an older one; a removed one stays as a tombstone, so it isn't brought
// back by a PC that still had it. Nothing here knows Electron or what the entries mean (main.js).

const MAX_VALUE = 16 * 1024; // one entry's value, as JSON
const MAX_KEY = 80;

// `state`: what was saved ({ items, vv, seq }), `me`: this PC's id
function createMind({ me, state = null }) {
  const s = {
    items: { ...(state?.items || {}) }, // key -> { v, at, by, seq, del }
    vv: { ...(state?.vv || {}) },       // PC id -> its highest number seen here
    seq: Number(state?.seq) || 0,
  };
  s.seq = Math.max(s.seq, Number(s.vv[me]) || 0);

  const newer = (a, b) => !b || a.at > b.at || (a.at === b.at && a.by > b.by);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // A value of ours (`del`: removed). Nothing changes if it's already what's there. true if written.
  function write(key, value, { del = false, now = Date.now() } = {}) {
    const old = s.items[key];
    if (old && Boolean(old.del) === del && (del || same(old.v, value))) return false;
    if (!old && del) return false;
    s.seq += 1;
    s.items[key] = { v: del ? null : value, at: Math.max(now, (old?.at || 0) + 1), by: me, seq: s.seq, ...(del && { del: true }) };
    s.vv[me] = s.seq;
    return true;
  }

  // What another PC sent: kept where newer. The keys that changed here.
  function merge(items) {
    const changed = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (!valid(item)) continue;
      const { key, ...entry } = item;
      s.vv[entry.by] = Math.max(Number(s.vv[entry.by]) || 0, entry.seq);
      if (entry.by === me) continue; // ours, already here (or overwritten since)
      if (!newer(entry, s.items[key])) continue;
      s.items[key] = entry;
      changed.push(key);
    }
    return changed;
  }

  // What a PC that has seen `vv` hasn't: oldest first per PC, up to about `budget` characters of JSON
  // (at least one entry). { items, more }
  function since(vv = {}, budget = 40000) {
    const out = [];
    for (const [key, entry] of Object.entries(s.items)) {
      if (entry.seq > (Number(vv?.[entry.by]) || 0)) out.push({ key, ...entry });
    }
    out.sort((a, b) => (a.by === b.by ? a.seq - b.seq : a.by < b.by ? -1 : 1));
    const items = [];
    let size = 0;
    for (const item of out) {
      const n = JSON.stringify(item).length;
      if (items.length && size + n > budget) return { items, more: true };
      items.push(item);
      size += n;
    }
    return { items, more: false };
  }

  // Entries under a prefix, removed ones left out: [{ key, v, at }]
  function list(prefix) {
    return Object.entries(s.items)
      .filter(([key, entry]) => key.startsWith(prefix) && !entry.del)
      .map(([key, entry]) => ({ key, v: entry.v, at: entry.at }));
  }

  // Old entries under a prefix forgotten here, the `keep` newest by `rank` kept (tombstones a month
  // old too): what was seen stays seen, so they don't come back
  function prune(prefix, keep, rank = (e) => e.at, now = Date.now()) {
    const under = Object.entries(s.items).filter(([key]) => key.startsWith(prefix));
    const live = under.filter(([, e]) => !e.del).sort((a, b) => rank(b[1]) - rank(a[1]));
    for (const [key] of live.slice(keep)) delete s.items[key];
    for (const [key, e] of under) if (e.del && now - e.at > 30 * 24 * 3600 * 1000) delete s.items[key];
  }

  return {
    write,
    merge,
    since,
    list,
    prune,
    get: (key) => (s.items[key] && !s.items[key].del ? s.items[key].v : undefined),
    has: (key) => Boolean(s.items[key]),
    entry: (key) => (s.items[key] ? { ...s.items[key] } : undefined), // removed ones too: who removed it
    vv: () => ({ ...s.vv }),
    state: () => ({ items: s.items, vv: s.vv, seq: s.seq }),
  };
}

// An entry from another PC, as it must look (it's data from a paired PC, still checked)
function valid(item) {
  return Boolean(item) && typeof item.key === 'string' && item.key.length <= MAX_KEY
    && typeof item.by === 'string' && /^[0-9a-f]{16}$/.test(item.by)
    && Number.isSafeInteger(item.seq) && item.seq > 0 && Number.isFinite(item.at)
    && (item.del === true ? item.v === null : item.del === undefined)
    && JSON.stringify(item.v ?? null).length <= MAX_VALUE;
}

module.exports = { createMind, valid };
