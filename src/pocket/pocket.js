// Her chat in your pocket (main/pocket.js): this page, on your phone, at your PC's name on Tailscale.
// Paired once with the code from Mainframe, it keeps a key of its own in this browser (made here, and
// it can only be used, never read out) and signs a fresh challenge with it each time it opens. Then
// her chat: the one on your desktop, her answer coming in as she writes it.

const $ = (id) => document.getElementById(id);
const APP = 'io.github.nfgh057.capri'; // her app on Android (android/)
let t = {};
let keys = null;    // this phone's key pair (CryptoKey objects, as IndexedDB keeps them)
let events = null;  // her answers as they come (EventSource)
let pending = null; // { id, el, text }: her answer being written
// her notes while you were away, as they came: { id, at, line, project, quote }; the last few kept in
// this browser, so they're still there when the page opens again
const notes = (() => {
  try {
    return JSON.parse(localStorage.getItem('capri.pocket.notes') || '[]').filter((n) => n?.id && n.at && n.line);
  } catch {
    return [];
  }
})();
const keepNotes = () => {
  try {
    localStorage.setItem('capri.pocket.notes', JSON.stringify(notes.slice(-20)));
  } catch {
    // no storage here: they stay until the page closes
  }
};

// where her notes got to, the last time this page heard one (this browser's own storage; none, and it
// starts from now)
function since(at) {
  try {
    if (at) localStorage.setItem('capri.pocket.since', String(at));
    const kept = Number(localStorage.getItem('capri.pocket.since'));
    if (kept) return kept;
    localStorage.setItem('capri.pocket.since', String(Date.now()));
  } catch {
    // no storage here: from now
  }
  return Date.now();
}

// --- the server --------------------------------------------------------------------------------

async function api(method, url, body) {
  const res = await fetch(url, {
    method, cache: 'no-store', credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || String(res.status)), { status: res.status });
  return json;
}

// --- her key, in this browser ------------------------------------------------------------------

function store(mode, run) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('capri-pocket', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keys');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('keys', mode);
      const req = run(tx.objectStore('keys'));
      tx.oncomplete = () => resolve(req.result ?? null);
      tx.onerror = () => reject(tx.error);
    };
  });
}

const keyGet = () => store('readonly', (s) => s.get('me')).catch(() => null);
const keyPut = (pair) => store('readwrite', (s) => s.put(pair, 'me'));
const base64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(challenge) {
  const data = new TextEncoder().encode(`capri-pocket|${challenge}`);
  return base64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, data));
}

// --- what's on screen --------------------------------------------------------------------------

function show(id, status = '') {
  for (const part of ['pair', 'chat']) $(part).hidden = part !== id;
  $('status').hidden = !status;
  $('status').textContent = status;
}

function words() {
  document.documentElement.lang = t.lang || 'en';
  $('pairTitle').textContent = t.pairTitle || '';
  $('pairHow').textContent = t.pairHow || '';
  $('pairTip').textContent = t.pairTip || '';
  $('code').placeholder = t.code || '';
  $('pairGo').textContent = t.pair || 'OK';
  $('text').placeholder = t.placeholder || '';
  $('send').textContent = t.send || '>';
}

function pairError(text) {
  $('pairError').hidden = !text;
  $('pairError').textContent = text || '';
}

const unTagged = (text) => String(text).replace(/\[\[[^\]]*\]\]/g, '').trim(); // [[open: …]], as her chat hides them

function when(at) {
  if (!at) return '';
  const d = new Date(at);
  const today = d.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(t.lang || undefined, today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

// one message: hers in yellow on the left, yours in cyan on the right, as in Mainframe's HOLO
function bubble(role, text, at) {
  const you = role === 'user';
  const box = document.createElement('div');
  box.className = `msg ${you ? 'msg--you' : 'msg--her'}`;
  const head = document.createElement('p');
  head.className = 'msg__head';
  head.textContent = `${you ? `< ${t.you || 'YOU'}` : '> CAPRI'}${at ? ` · ${when(at)}` : ''}`;
  const body = document.createElement('p');
  body.className = 'msg__text';
  body.textContent = you ? text : unTagged(text);
  box.append(head, body);
  return box;
}

// one of her notes (Claude Code needs you, it's done…): dimmer, its project on top, a bit of what was said under it
function noteBubble(n) {
  const box = document.createElement('div');
  box.className = 'msg msg--note';
  const head = document.createElement('p');
  head.className = 'msg__head';
  head.textContent = ['> CAPRI', n.project, when(n.at)].filter(Boolean).join(' · ');
  const body = document.createElement('p');
  body.className = 'msg__text';
  body.textContent = n.line;
  box.append(head, body);
  if (n.quote) {
    const quote = document.createElement('p');
    quote.className = 'msg__quote';
    quote.textContent = n.quote;
    box.append(quote);
  }
  return box;
}

function scrollDown() {
  const log = $('log');
  log.scrollTop = log.scrollHeight;
}

async function loadHistory() {
  const { history } = await api('GET', '/api/history');
  const log = $('log');
  // her chat and her notes, in the order they came
  const all = [
    ...history.filter((m) => ['user', 'assistant'].includes(m.role) && m.content).map((m) => ({ at: m.at, el: () => bubble(m.role, m.content, m.at) })),
    ...notes.map((n) => ({ at: n.at, el: () => noteBubble(n) })),
  ].sort((a, b) => a.at - b.at);
  log.replaceChildren(...all.map((m) => m.el()));
  if (pending) log.append(pending.el);
  scrollDown();
}

// --- pairing and opening -----------------------------------------------------------------------

// this phone paired with the code from Mainframe: a new key made here, its public half to her
async function pair(code) {
  pairError('');
  $('pairGo').disabled = true;
  try {
    const made = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const key = await crypto.subtle.exportKey('jwk', made.publicKey);
    const { challenge } = await api('POST', '/api/pair', { code, key });
    await keyPut(made);
    keys = made;
    await hello(challenge);
  } catch (err) {
    pairError(err.message === 'noPairing' ? t.pairClosed : err.message === 'badCode' ? t.pairWrong : `${t.failed || ''} ${err.message}`);
  } finally {
    $('pairGo').disabled = false;
  }
}

// the challenge signed with this phone's key: a session, then her chat
async function hello(challenge) {
  await api('POST', '/api/hello', { challenge, sig: await sign(challenge) });
  show('chat');
  await loadHistory();
  listen();
}

async function boot() {
  let start;
  try {
    start = await api('GET', '/api/start');
  } catch {
    show(null, t.offline || 'Capri…');
    setTimeout(boot, 5000);
    return;
  }
  t = start.t || {};
  words();
  $('pc').textContent = start.name || '';
  // the code from Mainframe's QR code: read here, never sent anywhere in the address
  const code = new URLSearchParams(location.hash.slice(1)).get('pair');
  if (code) history.replaceState(null, '', location.pathname);
  keys = await keyGet();
  if (start.paired && keys) {
    try {
      return await hello(start.challenge);
    } catch (err) {
      if (err.status !== 403) {
        show(null, t.offline);
        setTimeout(boot, 5000);
        return;
      }
      pairError(t.lost); // paired again from another browser, or this one's key isn't the one she has
    }
  } else if (start.paired) {
    pairError(t.lost);
  }
  show('pair');
  if (code && start.pairing) {
    $('code').value = code;
    // on Android, her app may be the one to pair: the code goes to it, and only to it (its package)
    if (/Android/i.test(navigator.userAgent)) {
      const link = $('pairApp');
      link.href = `intent://pair?u=${encodeURIComponent(location.origin)}&c=${encodeURIComponent(code)}#Intent;scheme=capri;package=${APP};end`;
      link.textContent = t.pairApp || 'Capri';
      link.hidden = false;
      $('pairGo').textContent = t.pairBrowser || t.pair || 'OK';
      return;
    }
    await pair(code);
  }
}

// --- her chat ----------------------------------------------------------------------------------

function listen() {
  events?.close();
  events = new EventSource(`/api/events?since=${since()}`); // her notes since the last one heard here, then as they come
  events.addEventListener('note', (e) => {
    const n = JSON.parse(e.data);
    if (notes.some((m) => m.id === n.id)) return;
    notes.push(n);
    keepNotes();
    since(n.at);
    $('log').append(noteBubble(n));
    scrollDown();
  });
  events.addEventListener('delta', (e) => {
    const d = JSON.parse(e.data);
    if (pending?.id !== d.id) return;
    pending.text += d.text;
    pending.el.querySelector('.msg__text').textContent = unTagged(pending.text);
    scrollDown();
  });
  events.addEventListener('answer', (e) => {
    const d = JSON.parse(e.data);
    if (pending?.id !== d.id) return;
    const done = pending;
    pending = null;
    $('send').disabled = false;
    if (d.ok) done.el.replaceWith(bubble('assistant', d.text, Date.now()));
    else {
      done.el.classList.add('is-error');
      done.el.querySelector('.msg__text').textContent = `${t.failed || ''} ${d.error}`;
    }
    scrollDown();
  });
  // her PC restarted, or the session ran out: opened again, signed again
  events.onerror = () => {
    if (events.readyState === EventSource.CLOSED) setTimeout(boot, 3000);
  };
}

async function say(text) {
  $('send').disabled = true;
  try {
    const { id } = await api('POST', '/api/send', { text });
    $('log').append(bubble('user', text, Date.now()));
    const el = bubble('assistant', t.thinking || '…');
    el.classList.add('is-pending');
    pending = { id, el, text: '' };
    $('log').append(el);
    scrollDown();
  } catch (err) {
    $('send').disabled = false;
    $('text').value = text;
    if (err.status === 401) return boot();
    show('chat', err.message === 'tooMany' ? t.tooMany : t.offline);
  }
}

$('pairForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim();
  if (code) pair(code);
});

$('say').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text || pending) return;
  $('text').value = '';
  grow();
  show('chat');
  say(text);
});

// Enter sends, Shift+Enter a new line; the box grows with what's typed
const grow = () => {
  const box = $('text');
  box.style.height = 'auto';
  box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
};
$('text').addEventListener('input', grow);
$('text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('say').requestSubmit();
  }
});

// her QR code scanned again with the page already open here: its code read now
window.addEventListener('hashchange', () => {
  if (location.hash.includes('pair=')) boot();
});

// back to the page after a while: what was said meanwhile (on the desktop too)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('chat').hidden) loadHistory().catch(() => boot());
});

boot();
