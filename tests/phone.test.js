'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const phone = require('../src/main/phone');
const totp = require('../src/main/totp');

const TOKEN = '123456:AAbbCCddEEffGGhhIIjjKKllMMnnOOppQQ';

// A Telegram of its own: getMe, getUpdates (answering with what's queued, after a short wait when
// there's nothing), sendMessage, and the rest answered ok
async function fakeTelegram(t) {
  const calls = [];
  const queue = [];
  let next = 1;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const [, token, method] = req.url.match(/^\/bot([^/]+)\/(\w+)$/) || [];
      const params = JSON.parse(body || '{}');
      calls.push({ token, method, params });
      const reply = (status, json) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (token !== TOKEN) return reply(401, { ok: false, description: 'Unauthorized' });
      if (method === 'getMe') return reply(200, { ok: true, result: { id: 1, is_bot: true, username: 'capri_test_bot' } });
      if (method === 'sendMessage') return reply(200, { ok: true, result: { message_id: 1 } });
      if (method === 'getUpdates') {
        const fresh = queue.filter((u) => params.offset < 0 || u.update_id >= params.offset);
        const answer = () => reply(200, { ok: true, result: params.offset < 0 ? fresh.slice(-1) : fresh });
        return fresh.length || !params.timeout ? answer() : setTimeout(answer, 50);
      }
      if (['sendChatAction', 'deleteMessage', 'answerCallbackQuery', 'setMyCommands'].includes(method)) return reply(200, { ok: true, result: true });
      return reply(404, { ok: false });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections(); // a long poll stopped midway leaves its connection open
  }));
  phone.useApi(`http://127.0.0.1:${server.address().port}`);
  const say = (from, chat, text) => queue.push({ update_id: next++, message: { from, chat, text } });
  return { calls, say };
}

test('a token Telegram does not know, or one that is not shaped like a token, is said so (and never repeated)', async (t) => {
  await fakeTelegram(t);
  await assert.rejects(phone.bot('nope'), (err) => err.message === 'badToken');
  await assert.rejects(phone.bot('999:ZZbbCCddEEffGGhhIIjjKKllMMnnOOppQQ'), (err) => err.message === 'badToken');
  assert.deepEqual(await phone.bot(TOKEN), { id: 1, username: 'capri_test_bot' });
});

test('pairing takes only `/start <code>`, in a private chat, sent after the code was made', async (t) => {
  const tg = await fakeTelegram(t);
  const { code, link } = phone.pairing('capri_test_bot');
  assert.equal(link, `https://t.me/capri_test_bot?start=${code}`);
  const me = { id: 42, username: 'me' };
  tg.say(me, { id: 42, type: 'private' }, `/start ${code}`); // already there: skipped
  const waiting = phone.waitForPair(TOKEN, code, AbortSignal.timeout(5000));
  await new Promise((r) => setTimeout(r, 100));
  tg.say({ id: 7, username: 'them' }, { id: -100, type: 'group' }, `/start ${code}`);
  tg.say({ id: 8, username: 'other' }, { id: 8, type: 'private' }, '/start wrong');
  tg.say({ id: 9, is_bot: true }, { id: 9, type: 'private' }, `/start ${code}`);
  tg.say(me, { id: 42, type: 'private' }, `/start ${code}`);
  assert.deepEqual(await waiting, { chat: 42, user: 42, name: '@me' });
});

test('what goes out: her line and the project, a snippet only if asked, keys blanked', () => {
  const note = { line: 'Claude’s done.', project: 'capri', quote: 'Set   OPENAI to sk-proj-abcdefghijklmnop1234 and done' };
  assert.equal(phone.compose(note, 'line'), 'Claude’s done.\n[capri]');
  assert.equal(phone.compose(note, 'quote'), 'Claude’s done.\n[capri]\nSet OPENAI to […] and done');
  assert.equal(phone.redact(`bot ${TOKEN} here`), 'bot […] here');
  assert.equal(phone.redact('C:/Users/someone/Code/projects/capri-desktop/src/main'), 'C:/Users/someone/Code/projects/capri-desktop/src/main');
  assert.ok(phone.compose({ line: 'x', quote: 'y'.repeat(5000) }, 'quote').length < 800);
});

test('a few messages a minute at most, and not the same one twice in a row', () => {
  const allow = phone.limiter(3);
  assert.equal(allow('a', 0), true);
  assert.equal(allow('a', 1000), false);
  assert.equal(allow('b', 2000), true);
  assert.equal(allow('c', 3000), true);
  assert.equal(allow('d', 4000), false);
  assert.equal(allow('d', 61000), true);
});

test('sending goes to the paired chat, as plain text', async (t) => {
  const tg = await fakeTelegram(t);
  await phone.send(TOKEN, 42, 'hej');
  assert.deepEqual(tg.calls.at(-1).params, { chat_id: 42, text: 'hej', link_preview_options: { is_disabled: true } });
});

test('the authenticator code: RFC 6238, a step either side, each code once', () => {
  // RFC 6238's SHA-1 key, "12345678901234567890", in base32; its 8-digit codes end in these 6
  const key = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp.code(key, Math.floor(59 / 30)), '287082');
  assert.equal(totp.code(key, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.code(key, Math.floor(20000000000 / 30)), '353130');
  const secret = totp.secret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const now = 1_800_000_000_000;
  const step = totp.stepAt(now);
  assert.equal(totp.check(secret, totp.code(secret, step), { now }), step);
  assert.equal(totp.check(secret, totp.code(secret, step - 1), { now }), step - 1);
  assert.equal(totp.check(secret, totp.code(secret, step + 1), { now }), step + 1);
  assert.equal(totp.check(secret, totp.code(secret, step - 2), { now }), null);
  assert.equal(totp.check(secret, totp.code(secret, step), { now, after: step }), null); // used already
  assert.equal(totp.check(secret, ` ${totp.code(secret, step).replace(/(\d{3})/, '$1 ')}`, { now }), step); // "123 456"
  for (const typed of ['', '12345', '1234567', 'abcdef', null]) assert.equal(totp.check(secret, typed, { now }), null);
  assert.equal(totp.link('ABC', 'my_bot'), 'otpauth://totp/Capri%3Amy_bot?secret=ABC&issuer=Capri&algorithm=SHA1&digits=6&period=30');
  assert.match(totp.qr(totp.link(secret, 'my_bot')), /^data:image\/gif;base64,/);
});

test('only you, in your chat with the bot: anyone else is not even answered', () => {
  const owner = { chat: 42, user: 42 };
  const me = { id: 42 };
  const mine = { id: 42, type: 'private' };
  const msg = (from, chat, text) => ({ message: { message_id: 5, from, chat, text } });
  assert.equal(phone.fromOwner(msg({ id: 7 }, { id: 7, type: 'private' }, '/unlock 123456'), owner), null);
  assert.equal(phone.fromOwner(msg(me, { id: -100, type: 'group' }, '/unlock 123456'), owner), null); // you, in a group
  assert.equal(phone.fromOwner(msg({ id: 7 }, mine, 'hi'), owner), null);
  assert.equal(phone.fromOwner(msg({ id: 42, is_bot: true }, mine, 'hi'), owner), null);
  assert.equal(phone.fromOwner({ edited_message: {} }, owner), null);
  assert.deepEqual(phone.fromOwner(msg(me, mine, '/unlock 123 456'), owner), { message: 5, text: '/unlock 123 456', command: 'unlock', rest: '123 456' });
  assert.deepEqual(phone.fromOwner(msg(me, mine, '/Lock@capri_test_bot'), owner), { message: 5, text: '/Lock@capri_test_bot', command: 'lock', rest: '' });
  assert.deepEqual(phone.fromOwner(msg(me, mine, '  hej, co tam?  '), owner), { message: 5, text: 'hej, co tam?', command: null, rest: '' });
  assert.deepEqual(phone.fromOwner(msg(me, mine, undefined), owner), { message: 5, text: '', command: null, rest: '' }); // a photo
  assert.equal(phone.fromOwner(msg(me, mine, '/unlocked'), owner).command, 'unlocked'); // not /unlock
  const press = (from, chat) => ({ callback_query: { id: 'q', from, data: 'mute', message: { chat, text: 'Claude is done' } } });
  assert.deepEqual(phone.fromOwner(press(me, mine), owner), { press: 'q', data: 'mute', text: 'Claude is done' });
  assert.equal(phone.fromOwner(press({ id: 7 }, mine), owner), null);
  assert.equal(phone.fromOwner(press(me, { id: 7 }), owner), null);
});

test('listening: what was there before is skipped, what comes after arrives in order, until stopped', async (t) => {
  const tg = await fakeTelegram(t);
  const me = { id: 42 };
  const mine = { id: 42, type: 'private' };
  tg.say(me, mine, 'old');
  const heard = [];
  const stop = new AbortController();
  const done = phone.listen(TOKEN, (u) => { heard.push(u.message.text); }, stop.signal);
  await new Promise((r) => setTimeout(r, 120));
  tg.say(me, mine, 'one');
  tg.say(me, mine, 'two');
  await new Promise((r) => setTimeout(r, 200));
  stop.abort();
  await done;
  assert.deepEqual(heard, ['one', 'two']);
  // a bad token: told once, and it ends
  const failed = [];
  await phone.listen('999:ZZbbCCddEEffGGhhIIjjKKllMMnnOOppQQ', () => {}, new AbortController().signal, (err) => failed.push(err.message));
  assert.deepEqual(failed, ['badToken']);
});

test('her answers: long ones in a few messages, buttons under a message when asked', async (t) => {
  const tg = await fakeTelegram(t);
  const long = `${'a'.repeat(3000)}\n${'b'.repeat(3000)}\n${'c'.repeat(3000)}\n${'d'.repeat(3000)}`;
  await phone.sendLong(TOKEN, 42, long);
  const sent = tg.calls.filter((c) => c.method === 'sendMessage').map((c) => c.params.text);
  assert.equal(sent.length, 3);
  assert.ok(sent.every((text) => text.length <= phone.MAX_TEXT));
  assert.equal(sent[0], 'a'.repeat(3000));
  assert.ok(sent[2].endsWith('…')); // what's left after three is cut, not sent on and on
  await phone.send(TOKEN, 42, 'Claude is done', { buttons: [[{ text: 'Later', data: 'later' }, { text: 'Quiet', data: 'mute' }]] });
  assert.deepEqual(tg.calls.at(-1).params.reply_markup, {
    inline_keyboard: [[{ text: 'Later', callback_data: 'later' }, { text: 'Quiet', callback_data: 'mute' }]],
  });
});
