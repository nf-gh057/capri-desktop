'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSpotter, clean, verdict, prompt } = require('../src/main/spot');

const known = { chatgpt: 'chatgpt', lechat: 'lechat', mistralai: 'lechat' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('a title as she asks about it: the page\'s own, without the browser, unread counts or Edge\'s other tabs', () => {
  assert.equal(clean('Poe - Fast, Helpful AI Chat - Google Chrome', true), 'Poe - Fast, Helpful AI Chat');
  assert.equal(clean('Why Poe is shutting down - YouTube — Mozilla Firefox', true), 'Why Poe is shutting down - YouTube');
  assert.equal(clean('(3) HuggingChat - Personal - Microsoft​ Edge', true), 'HuggingChat - Personal');
  assert.equal(clean('Pi and 3 more pages - Work - Microsoft Edge', true), 'Pi - Work');
  assert.equal(clean('Pi et 2 autres pages - Microsoft Edge', true), 'Pi');
  assert.equal(clean('Pi i 3 inne strony - Microsoft Edge', true), 'Pi');
  assert.equal(clean('● notes.txt - Notepad', false), 'notes.txt - Notepad');
  // an app keeps its whole title
  assert.equal(clean('LM Studio - Google Chrome', false), 'LM Studio - Google Chrome');
});

test('search results are never asked about: a small model takes them for the AI searched for', () => {
  assert.equal(clean('poe ai - Google Search - Google Chrome', true), '');
  assert.equal(clean('jan ai — Szukaj w Google — Mozilla Firefox', true), '');
  assert.equal(clean('kimi - DuckDuckGo - Brave', true), '');
});

test('the model\'s answer: another AI only with a name the title has, the same key as on her list', () => {
  assert.deepEqual(verdict('{"kind":"ai_chat","name":"Poe"}', 'Poe - Fast, Helpful AI Chat'), { key: 'poe', name: 'Poe', page: 'chat' });
  assert.deepEqual(verdict({ kind: 'ai_download', name: 'LM Studio' }, 'Download LM Studio'), { key: 'lmstudio', name: 'LM Studio', page: 'download' });
  assert.deepEqual(verdict({ kind: 'ai_chat', name: 'Mistral AI' }, 'Chat | Mistral AI', known), { key: 'lechat', name: 'Mistral AI', page: 'chat' });
  assert.deepEqual(verdict({ kind: 'ai_chat', name: 'ГигаЧат' }, 'ГигаЧат'), { key: 'гигачат', name: 'ГигаЧат', page: 'chat' });
  // a guess the title doesn't back
  assert.equal(verdict({ kind: 'ai_chat', name: 'ChatGPT' }, 'Inbox (3) - Gmail'), null);
  assert.equal(verdict({ kind: 'about_ai', name: 'Poe' }, 'Why Poe is shutting down - YouTube'), null);
  assert.equal(verdict({ kind: 'not_ai', name: '' }, 'Elden Ring'), null);
  assert.equal(verdict('not json', 'Poe'), null);
  assert.equal(verdict({ kind: 'ai_chat', name: '' }, 'Poe'), null);
});

test('the prompt has the title, and whether it is a tab or an app', () => {
  const p = prompt('Poe - Fast AI Chat', true);
  assert.match(p, /This window: "Poe - Fast AI Chat" \(browser tab\)$/);
  assert.match(prompt('LM Studio', false), /\(app\)$/);
});

test('she asks once a title stays in front, remembers the answer, and keeps no title on disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-spot-'));
  const file = path.join(dir, 'ai-titles.json');
  const asked = [];
  const changes = [];
  const answers = { Poe: { kind: 'ai_chat', name: 'Poe' }, 'Kimi chat': { kind: 'ai_chat', name: 'Kimi' } };
  const ask = async (p) => {
    const title = JSON.parse(/This window: (".*") \(/.exec(p)[1]);
    asked.push(title);
    return JSON.stringify(answers[title] || { kind: 'not_ai', name: '' });
  };
  const spot = createSpotter({ file, ask, known, dwell: 60, gap: 10, onChange: (v) => changes.push(v) });

  // flicked past: not asked
  assert.equal(spot.check('Inbox - Gmail - Google Chrome', true), null);
  await wait(20);
  assert.equal(spot.check('Poe - Google Chrome', true), null);
  await wait(150);
  assert.deepEqual(asked, ['Poe']);
  assert.deepEqual(changes, [{ key: 'poe', name: 'Poe', page: 'chat' }]);
  // known now, without asking again
  assert.deepEqual(spot.check('Poe - Google Chrome', true), { key: 'poe', name: 'Poe', page: 'chat' });
  // a game, her own window: nothing asked
  spot.idle();
  await wait(100);
  assert.equal(asked.length, 1);

  spot.check('Kimi chat - Microsoft Edge', true);
  await wait(150);
  spot.flush();
  const kept = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(kept, /Poe - |Kimi chat|Gmail/); // hashes of titles, and the AIs' names
  assert.equal(Object.keys(JSON.parse(kept)).length, 2);

  // the next run knows them
  const again = createSpotter({ file, ask, known, dwell: 60 });
  assert.equal(again.check('Kimi chat - Google Chrome', true).key, 'kimi');
  // you said it's no AI: not taken for one again, nor asked about
  again.forget('kimi');
  assert.equal(again.check('Kimi chat - Google Chrome', true), null);
  await wait(120);
  assert.equal(asked.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('no model on this PC: she waits a while before asking again, and keeps no answer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-spot-'));
  let tries = 0;
  const spot = createSpotter({
    file: path.join(dir, 'a.json'), dwell: 20, gap: 10, backoff: 300,
    ask: async () => {
      tries++;
      throw new Error('no model on this PC');
    },
  });
  spot.check('Poe', false);
  await wait(120);
  assert.equal(tries, 1);
  assert.equal(spot.check('Poe', false), null);
  await wait(350);
  assert.equal(tries, 2);
  spot.idle();
  fs.rmSync(dir, { recursive: true, force: true });
});
