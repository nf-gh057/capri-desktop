'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const phone = require('../src/main/phone');

const TOKEN = '123456:AAbbCCddEEffGGhhIIjjKKllMMnnOOppQQ';

// A Telegram of its own: getMe, getUpdates (answering with what's queued) and sendMessage
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
        return reply(200, { ok: true, result: params.offset < 0 ? fresh.slice(-1) : fresh });
      }
      return reply(404, { ok: false });
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
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
