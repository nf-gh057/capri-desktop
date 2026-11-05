'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { split, clean, ready, tooSlow, pieces } = require('../src/main/tts');
const { TRAY } = require('../src/main/labels');

test('what she reads out: no code, links, markdown marks, emoji or stage tags', () => {
  assert.equal(clean('**Hej** [smile] zobacz `npm test` i https://x.y/z 🙂 ok'), 'Hej zobacz npm test i ok');
  assert.equal(clean('Masz:\n```js\nconst a = 1;\n```\nGotowe.'), 'Masz: Gotowe.');
  assert.equal(clean('[link](https://a.b) i _to_'), 'link i to');
});

test('her line in pieces: sentences, a short first one, the long ones cut at a comma', () => {
  assert.deepEqual(split('Raz dwa. Trzy cztery? Pięć!'), ['Raz dwa. Trzy cztery?', 'Pięć!']);
  assert.deepEqual(split('Wersja 0.5 jest w main.js, sprawdź. Gotowe.'), ['Wersja 0.5 jest w main.js, sprawdź.', 'Gotowe.']);
  const long = 'Bo widzę, że coś kombinujesz, a ja lubię wiedzieć, co się dzieje na tym komputerze, zanim coś wybuchnie, serio.';
  const [first, ...rest] = split(long);
  assert.ok(first.length <= 90, first);
  assert.ok(first.endsWith(','), first);
  assert.equal([first, ...rest].join(' '), long);
  // no piece longer than her server's cache holds
  const wall = Array.from({ length: 60 }, (_, i) => `słowo${i}`).join(' ');
  assert.ok(split(wall).every((p) => p.length <= 220));
  assert.equal(split(wall).join(' '), wall);
});

test('a word or two goes with the next sentence', () => {
  assert.deepEqual(split('Hm. No dobra, niech ci będzie.'), ['Hm. No dobra, niech ci będzie.']);
  assert.deepEqual(split(''), []);
  assert.deepEqual(split('```\ncode only\n```'), []);
});

test('an answer coming in: only whole sentences go out, the rest once done', () => {
  assert.deepEqual(ready('Raz. Dwa trzy', 0, false), { text: 'Raz.', upTo: 4 });
  assert.deepEqual(ready('Raz. Dwa trzy', 4, false), { text: '', upTo: 4 });
  assert.deepEqual(ready('Raz. Dwa trzy. Cz', 4, false), { text: ' Dwa trzy.', upTo: 14 });
  assert.deepEqual(ready('Raz. Dwa trzy', 4, true), { text: ' Dwa trzy', upTo: 13 });
  // a dot in a number or a name isn't the end of a sentence until a space follows
  assert.deepEqual(ready('Wersja 0.5', 0, false), { text: '', upTo: 0 });
});

test('too slow to keep up: on the last few lines she made, not on one', () => {
  assert.equal(tooSlow([]), false);
  assert.equal(tooSlow([0.5, 0.6, 0.55]), false);
  assert.equal(tooSlow([0.5, 0.5, 2.4]), true);   // a game started: the average goes past 1
  assert.equal(tooSlow([3, 0.5, 0.5, 0.5]), false); // only the last three count
});

test('her fixed lines to say ahead of time: as she says them, each once', () => {
  assert.deepEqual(pieces(['Hej, choom. Co tam?', 'Hej, choom. Co tam?', 'Ok.', 42]), ['Hej, choom. Co tam?', 'Ok.']);
  const long = 'Bo widzę, że coś kombinujesz, a ja lubię wiedzieć, co się dzieje na tym komputerze, zanim coś wybuchnie, serio.';
  assert.deepEqual(pieces([long]), split(long));
});

test('which of her lines: whole sentences with nothing to fill in, her chat\'s only in chat mode', async () => {
  const { fixedLines } = await import('../src/renderer/js/speech.js');
  const labels = {
    chat: { badge: 'AI · LIVE', talk: 'Talk to me', hello: ['Hey, choom. What’s on your mind?', 'Hi {name}!'] },
    thrown: ['Whoa! Not again.'],
    verbs: { Read: 'Reads.' },
    motion: { full: 'Move!', still: 'Stay calm' },
  };
  assert.deepEqual(fixedLines(labels, 'chat'), ['Hey, choom. What’s on your mind?']);
  assert.deepEqual(fixedLines(labels, 'all'), ['Hey, choom. What’s on your mind?', 'Whoa! Not again.', 'Move!']);
  assert.deepEqual(fixedLines(null, 'chat'), []);
});

test('Mainframe\'s Voice in every language', () => {
  const keys = Object.keys(TRAY.en).filter((k) => k.startsWith('voice') || k === 'secVoice');
  assert.ok(keys.length >= 20);
  for (const lang of ['en', 'pl']) {
    for (const key of keys) assert.ok(TRAY[lang][key], `${lang}.${key}`);
    assert.match(TRAY[lang].voiceReady('RTX'), /RTX/);
  }
});
