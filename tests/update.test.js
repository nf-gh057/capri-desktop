'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const update = require('../src/main/update');

const LOCK = '{"version":"0.4.4-1","packages":{"":{"version":"0.4.4-1"}}}';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString().trim();

// "GitHub" (a bare repository), her clone of it, and another clone pushing new versions
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hub = path.join(root, 'hub.git');
  const dev = path.join(root, 'dev');
  const her = path.join(root, 'her');
  git(root, 'init', '--quiet', '--bare', '--initial-branch=main', hub);
  git(root, 'clone', '--quiet', hub, dev);
  const commit = (version, title, files = {}) => {
    fs.writeFileSync(path.join(dev, 'package.json'), JSON.stringify({ name: 'capri', version }));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dev, name), text);
    git(dev, 'add', '-A');
    git(dev, 'commit', '--quiet', '-m', title);
    git(dev, 'push', '--quiet', 'origin', 'HEAD:main');
  };
  commit('0.4.4-1', '0.4.4-1: first', { 'main.js': 'one', 'package-lock.json': LOCK });
  git(root, 'clone', '--quiet', hub, her);
  return { root, hub, dev, her, commit };
}

test('nothing new: current; a new version on GitHub: behind, with its version and what changed', async (t) => {
  const { her, commit } = setup(t);
  assert.equal((await update.check(her)).state, 'current');
  commit('0.4.4-2', '0.4.4-2: her swarm', { 'main.js': 'two' });
  commit('0.4.4-3', '0.4.4-3: her updates', { 'main.js': 'three' });
  const info = await update.check(her);
  assert.equal(info.state, 'behind');
  assert.equal(info.behind, 2);
  assert.equal(info.version, '0.4.4-3');
  assert.deepEqual(info.changes.map((c) => c.title), ['0.4.4-3: her updates', '0.4.4-2: her swarm']);
  assert.equal(info.branch, 'main');
  assert.equal(update.blocked(info), null);
});

test('updating: fast-forward to what was seen; her packages only when they changed', async (t) => {
  const { her, commit } = setup(t);
  commit('0.4.4-2', '0.4.4-2: code only', { 'main.js': 'two' });
  let done = await update.apply(her, await update.check(her));
  assert.equal(done.install, false);
  assert.equal(fs.readFileSync(path.join(her, 'main.js'), 'utf8'), 'two');
  // the version is in her lock file too: a new one alone isn't new packages
  commit('0.4.4-3', '0.4.4-3: version only', { 'package-lock.json': '{"version":"0.4.4-3","packages":{"":{"version":"0.4.4-3"}}}' });
  done = await update.apply(her, await update.check(her));
  assert.equal(done.install, false);
  commit('0.4.4-4', '0.4.4-4: a new package', { 'package-lock.json': '{"version":"0.4.4-4","packages":{"":{"version":"0.4.4-4"},"node_modules/x":{}}}' });
  done = await update.apply(her, await update.check(her));
  assert.equal(done.install, true);
  assert.equal((await update.check(her)).state, 'current');
  await assert.rejects(update.apply(her, await update.check(her)), { code: 'current' });
});

test('changes of yours, another branch, or commits GitHub lacks: she says why and leaves it', async (t) => {
  const { her, commit } = setup(t);
  commit('0.4.4-2', '0.4.4-2', { 'main.js': 'two' });
  fs.writeFileSync(path.join(her, 'main.js'), 'mine');
  let info = await update.check(her);
  assert.equal(update.blocked(info), 'dirty');
  await assert.rejects(update.apply(her, info), { code: 'dirty' });
  assert.equal(fs.readFileSync(path.join(her, 'main.js'), 'utf8'), 'mine'); // untouched
  git(her, 'checkout', '--quiet', '--', 'main.js');
  git(her, 'checkout', '--quiet', '-b', 'mine');
  info = await update.check(her, { branch: 'main' });
  assert.equal(update.blocked(info), 'branch');
  git(her, 'checkout', '--quiet', 'main');
  fs.writeFileSync(path.join(her, 'extra.js'), 'x');
  git(her, 'add', '-A');
  git(her, 'commit', '--quiet', '-m', 'mine');
  info = await update.check(her);
  assert.equal(info.state, 'diverged');
  await assert.rejects(update.apply(her, info), { code: 'diverged' });
});

test('no network (GitHub out of reach): offline, nothing changed; not a clone: notGit', async (t) => {
  const { root, her, hub } = setup(t);
  fs.renameSync(hub, `${hub}.away`);
  assert.equal((await update.check(her)).state, 'offline');
  const plain = path.join(root, 'plain');
  fs.mkdirSync(plain);
  assert.equal((await update.check(plain)).state, 'notGit');
});

test('her packages failing after an update: back to where she was, with hers', async (t) => {
  const { her, commit } = setup(t);
  const before = git(her, 'rev-parse', 'HEAD');
  commit('0.4.4-2', '0.4.4-2: broken package', { 'package-lock.json': '{"broken":true}' });
  const done = await update.apply(her, await update.check(her));
  const runs = [];
  const npm = async () => {
    runs.push(fs.readFileSync(path.join(her, 'package-lock.json'), 'utf8'));
    if (runs.length === 1) throw new Error('npm failed');
  };
  // Electron isn't there in this test: the second install (hers) "works" up to that, which is enough
  const result = await update.finish(her, done.from, { npm });
  assert.equal(result.ok, false);
  assert.equal(git(her, 'rev-parse', 'HEAD'), before);
  assert.deepEqual(runs, ['{"broken":true}', LOCK]);
});

test('versions: upstream first, then our commit on it', () => {
  assert.equal(update.newer('0.4.4-11', '0.4.4-7'), true);
  assert.equal(update.newer('0.4.5-1', '0.4.4-30'), true);
  assert.equal(update.newer('0.4.4-7', '0.4.4-7'), false);
  assert.equal(update.newer('0.4.4-7', '0.4.4-11'), false);
  assert.equal(update.newer('0.4.4', '0.4.4-1'), false);
  assert.equal(update.newer('1.0.0-1', '0.9.9-99'), true);
});
