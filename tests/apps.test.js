'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findWindow, variants, button, findButton, findButtons, appWindows, shortTitle } = require('../src/main/apps');

// the windows as apps.windows() lists them
const WINDOWS = [
  { id: 1, process: 'Notepad', label: 'Notepad', title: 'Bez tytułu — Notatnik' },
  { id: 2, process: 'Discord', label: 'Discord', title: '#ogólny - Discord' },
  { id: 3, process: 'chrome', label: 'Google Chrome', title: 'YouTube - Google Chrome' },
  { id: 4, process: 'ApplicationFrameHost', label: 'Application Frame Host', title: 'Kalkulator' },
  { id: 5, process: 'Spotify', label: 'Spotify', title: 'Spotify Premium' },
];
const find = (name) => {
  const found = findWindow(name, WINDOWS);
  return found && [found.win.id, found.similar ? 'similar' : 'found'];
};

test('a window by its name, its program or its title', () => {
  assert.deepEqual(find('Spotify'), [5, 'found']);
  assert.deepEqual(find('discord'), [2, 'found']);
  assert.deepEqual(find('youtube'), [3, 'found']);
  assert.deepEqual(find('kalkulator'), [4, 'found']);
});

test('the same app in her other languages', () => {
  for (const name of ['notatnik', 'notepad', 'bloc-notes', 'bloc de notas', 'bloco de notas', 'блокнот']) {
    assert.deepEqual(find(name), [1, 'found'], name);
  }
  assert.deepEqual(find('calculatrice'), [4, 'found']);
  assert.deepEqual(find('przeglądarka'), [3, 'found']); // a kind of app
  assert.equal(find('firefox'), null); // but one browser is never another
});

test('said in Polish, with its ending', () => {
  assert.deepEqual(find('notatnika'), [1, 'found']);
  assert.deepEqual(find('discorda'), [2, 'found']);
  assert.deepEqual(find('przeglądarki'), [3, 'found']);
});

test('a typo is only close: she asks first', () => {
  assert.deepEqual(find('spotfy'), [5, 'similar']);
  assert.deepEqual(find('notatnk'), [1, 'similar']);
  assert.deepEqual(find('dyskord'), [2, 'similar']);
});

test('nothing by that name', () => {
  assert.equal(find('excel'), null);
  assert.equal(find('kot'), null);
  assert.equal(find(''), null);
});

test('what to start when no window is open: the same names', () => {
  assert.ok(variants('notatnik').includes('notepad'));
  assert.ok(variants('Bloc-notes').includes('notatnik'));
});

test('an app’s windows each on their own: its name finds them all, a title just that one', () => {
  const list = [
    ...WINDOWS,
    { id: 6, process: 'firefox', label: 'Firefox', title: 'YouTube — Mozilla Firefox' },
    { id: 7, process: 'firefox', label: 'Firefox', title: 'Poczta — Outlook — Mozilla Firefox' },
    { id: 8, process: 'firefox', label: 'Firefox', title: 'GitHub - Mozilla Firefox' },
    { id: 9, process: 'ApplicationFrameHost', label: 'Application Frame Host', title: 'Zdjęcia' },
  ];
  const app = findWindow('firefox', list);
  assert.equal(app.named, true);
  assert.deepEqual(appWindows(app.win, list).map((w) => w.id), [6, 7, 8]);
  assert.deepEqual(appWindows(app.win, list).map(shortTitle), ['YouTube', 'Poczta — Outlook', 'GitHub']);
  const one = findWindow('github', list); // a word of its title: that window, not the app
  assert.deepEqual([one.win.id, one.named, one.similar], [8, false, false]);
  // Store apps share a process: only the frames named alike are one app
  assert.deepEqual(appWindows(list.find((w) => w.id === 4), list).map((w) => w.id), [4]);
});

test('taskbars on several screens: the app’s button on each', () => {
  const at = (x) => ({ x, y: 1040, w: 40, h: 40 });
  const buttons = [
    { name: 'Firefox — uruchomione okna: 2', ...at(700) },
    { name: 'Discord — 1 running window', ...at(760) },
    { name: 'Firefox — 1 running window', ...at(2700) }, // the second screen's taskbar
  ].map(button);
  assert.deepEqual(findButtons('firefox', buttons).map((b) => [b.x, b.count]), [[700, 2], [2700, 1]]);
  assert.deepEqual(findButtons('excel', buttons), []);
});

test('the taskbar: an app’s button and how many windows it has, in any language', () => {
  const at = { x: 0, y: 0, w: 40, h: 40 };
  const buttons = [
    { name: 'Firefox — uruchomione okna: 3 — przypięto', ...at },
    { name: 'Eksplorator plików — uruchomione okna: 5 — przypięto', ...at },
    { name: 'Word - 1 running window', ...at },
    { name: 'Microsoft Store — przypięto', ...at },
  ].map(button);
  assert.deepEqual(buttons.map((b) => [b.name, b.count]), [['Firefox', 3], ['Eksplorator plików', 5], ['Word', 1], ['Microsoft Store', 0]]);
  assert.equal(findButton('firefox', buttons).count, 3);
  assert.equal(findButton('explorer', buttons).count, 5); // its name in another language
  assert.equal(findButton('przeglądarka', buttons)?.name, 'Firefox');
  assert.equal(findButton('excel', buttons), null);
});
