'use strict';

// Her messages to your phone, through a Telegram bot of your own: plain HTTPS out to Telegram's Bot
// API, no port opened on this PC. She only sends; the one thing she reads is the code that pairs the
// bot with your chat (shown in Mainframe only), so nobody else's chat can ever be the one she writes to.
// The token comes in sealed and goes out only to api.telegram.org: never into a log or an error.

const { randomBytes } = require('node:crypto');

let API = 'https://api.telegram.org';
const PAIR_MS = 10 * 60 * 1000; // how long a pairing code works
const MAX_TEXT = 3500;          // under Telegram's 4096 characters
const PER_MINUTE = 5;

// --dev and tests only: a Telegram of their own
function useApi(url) {
  API = url;
}

class PhoneError extends Error {}

async function call(token, method, params = {}, { signal, wait = 0 } = {}) {
  if (!/^\d+:[\w-]{20,}$/.test(token || '')) throw new PhoneError('badToken');
  const timeout = AbortSignal.timeout((wait + 15) * 1000);
  let res;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    // fetch's message may carry the address, token and all: only what kind of failure it was
    if (signal?.aborted) throw new PhoneError('stopped');
    throw new PhoneError(err.name === 'TimeoutError' ? 'timeout' : 'offline');
  }
  const body = await res.json().catch(() => ({}));
  if (body.ok) return body.result;
  if (res.status === 401 || res.status === 404) throw new PhoneError('badToken');
  if (res.status === 409) throw new PhoneError('conflict'); // the bot is read elsewhere too (a webhook, another program)
  throw new PhoneError(String(body.description || `Telegram ${res.status}`).slice(0, 200));
}

// The bot the token belongs to: { id, username }
async function bot(token) {
  const me = await call(token, 'getMe');
  return { id: me.id, username: me.username };
}

// A new pairing code, and the link that opens the bot's chat with it typed in
function pairing(username) {
  const code = randomBytes(9).toString('base64url');
  return { code, link: `https://t.me/${username}?start=${code}`, until: Date.now() + PAIR_MS };
}

// Waits for `/start <code>` in a private chat with the bot: { chat, user, name } of whoever sent it.
// What was there before is skipped, and what comes after is marked read.
async function waitForPair(token, code, signal) {
  const until = Date.now() + PAIR_MS;
  const old = await call(token, 'getUpdates', { offset: -1, timeout: 0 }, { signal });
  let offset = old.length ? old.at(-1).update_id + 1 : 0;
  while (Date.now() < until) {
    const wait = Math.max(1, Math.min(25, Math.round((until - Date.now()) / 1000)));
    const updates = await call(token, 'getUpdates', { offset, timeout: wait, allowed_updates: ['message'] }, { signal, wait });
    for (const u of updates) {
      offset = u.update_id + 1;
      const m = u.message;
      if (m?.chat?.type !== 'private' || !m.from || m.from.is_bot) continue;
      if (String(m.text || '').trim() !== `/start ${code}`) continue;
      await call(token, 'getUpdates', { offset, timeout: 0 }, { signal }).catch(() => {});
      return { chat: m.chat.id, user: m.from.id, name: m.from.username ? `@${m.from.username}` : m.from.first_name || String(m.from.id) };
    }
  }
  throw new PhoneError('expired');
}

// Lines that look like a key or a token, blanked: a best effort, never a promise
function redact(text) {
  return String(text)
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr]|glpat|AKIA)[-_A-Za-z0-9]{12,}/g, '[…]')
    .replace(/\b\d{6,}:[\w-]{30,}\b/g, '[…]') // a Telegram bot token
    .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '[…]') // a JWT
    .replace(/\b(?=[\w+=-]*\d)(?=[\w+=-]*[A-Za-z])[\w+=-]{32,}/g, '[…]'); // anything long and random
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// What goes out: her line, the project, and (if you said so) a bit of what was said
function compose({ line, project, quote }, detail) {
  const parts = [clip(String(line || '').trim(), 300)];
  if (project) parts.push(`[${clip(String(project), 60)}]`);
  if (detail === 'quote' && quote) parts.push(clip(redact(String(quote).replace(/\s+/g, ' ').trim()), 400));
  return clip(parts.filter(Boolean).join('\n'), MAX_TEXT);
}

// No more than a few a minute, and never the same one twice in a row within a minute
function limiter(perMinute = PER_MINUTE) {
  const sent = [];
  let last = { text: null, at: 0 };
  return (text, now = Date.now()) => {
    while (sent.length && now - sent[0] > 60000) sent.shift();
    if (sent.length >= perMinute || (text === last.text && now - last.at < 60000)) return false;
    sent.push(now);
    last = { text, at: now };
    return true;
  };
}

function send(token, chat, text) {
  return call(token, 'sendMessage', { chat_id: chat, text, link_preview_options: { is_disabled: true } });
}

module.exports = { useApi, PhoneError, bot, pairing, waitForPair, compose, redact, limiter, send, PAIR_MS };
