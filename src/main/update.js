'use strict';

// Her own updates: Capri installed with install.ps1 is a git clone, so she can bring herself up to date
// as running the installer again would: what's new on her branch at `origin` (her repository, set when
// she was installed), fast-forward only, and her packages again only when they changed. Nothing here
// knows Electron: main.js asks, shows, and restarts her.

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const WIN = process.platform === 'win32';

function run(cmd, args, { cwd, timeout = 30000, shell = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, shell }, (err, stdout, stderr) => {
      if (err) {
        err.output = String(stderr || stdout || '').trim().slice(0, 500);
        reject(err);
      } else {
        resolve(String(stdout).trim());
      }
    });
  });
}

const git = (dir, args, opts = {}) => run('git', args, { cwd: dir, ...opts });

// What's on GitHub (her `origin`) next to what she runs:
// { state: 'current' | 'behind' | 'ahead' | 'diverged' | 'offline' | 'notGit', remote, branch, onBranch,
//   head, theirs, behind, ahead, version, changes: [{ id, title }], dirty }
async function check(dir, { branch: wanted = null } = {}) {
  const inside = await git(dir, ['rev-parse', '--is-inside-work-tree']).catch(() => null);
  if (inside !== 'true') return { state: 'notGit' };
  const current = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = wanted || current;
  const remote = await git(dir, ['remote', 'get-url', 'origin']).catch(() => null);
  if (!remote) return { state: 'notGit' };
  const info = { remote, branch, onBranch: current === branch };
  try {
    await git(dir, ['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { timeout: 90000 });
  } catch {
    return { ...info, state: 'offline' };
  }
  const theirs = `refs/remotes/origin/${branch}`;
  const [head, top, behind, ahead, dirty] = await Promise.all([
    git(dir, ['rev-parse', 'HEAD']),
    git(dir, ['rev-parse', theirs]),
    git(dir, ['rev-list', '--count', `HEAD..${theirs}`]).then(Number),
    git(dir, ['rev-list', '--count', `${theirs}..HEAD`]).then(Number),
    git(dir, ['status', '--porcelain', '--untracked-files=no']).then((out) => out.length > 0),
  ]);
  const version = await git(dir, ['show', `${theirs}:package.json`]).then((text) => JSON.parse(text).version).catch(() => null);
  const changes = behind
    ? (await git(dir, ['log', '--format=%h%x09%s', '-n', '20', `HEAD..${theirs}`])).split('\n').filter(Boolean)
      .map((line) => {
        const [id, ...title] = line.split('\t');
        return { id, title: title.join('\t').slice(0, 120) };
      })
    : [];
  const state = behind && ahead ? 'diverged' : behind ? 'behind' : ahead ? 'ahead' : 'current';
  return { ...info, state, head, theirs: top, behind, ahead, version, changes, dirty };
}

// Why she can't update herself from what `check` saw, if she can't: 'dirty' (changes of yours in her
// folder), 'branch' (another branch), 'diverged' (commits of yours GitHub doesn't have), else null
function blocked(info) {
  if (info?.state === 'diverged') return 'diverged';
  if (info?.state !== 'behind') return null;
  if (info.dirty) return 'dirty';
  if (!info.onBranch) return 'branch';
  return null;
}

// Her packages as of a commit, without her own version number (which changes with every commit of
// this fork): what npm installs, to tell whether it must run again
async function packagesAt(dir, rev) {
  const read = (file) => git(dir, ['show', `${rev}:${file}`]).then(JSON.parse).catch(() => null);
  const [pkg, lock] = await Promise.all([read('package.json'), read('package-lock.json')]);
  if (lock) {
    delete lock.version;
    if (lock.packages?.['']) delete lock.packages[''].version;
  }
  const deps = pkg && ['dependencies', 'devDependencies', 'optionalDependencies'].map((key) => pkg[key] || {});
  return JSON.stringify([deps, lock]);
}

// Fast-forwarded to what `check` saw on GitHub: { from, to, install } (install: her packages changed,
// npm must run, with her closed). Never anything but a fast-forward.
async function apply(dir, info) {
  const why = blocked(info);
  if (why) throw Object.assign(new Error(why), { code: why });
  if (info?.state !== 'behind') throw Object.assign(new Error('current'), { code: 'current' });
  const from = await git(dir, ['rev-parse', 'HEAD']);
  await git(dir, ['merge', '--ff-only', '--quiet', info.theirs]);
  const to = await git(dir, ['rev-parse', 'HEAD']);
  const [before, after] = await Promise.all([packagesAt(dir, from), packagesAt(dir, to)]);
  return { from, to, install: before !== after };
}

const electronThere = (dir) => fs.existsSync(path.join(dir, 'node_modules', 'electron', 'dist', WIN ? 'electron.exe' : 'electron'));

// Her packages installed again (npm ci, then Electron's own program if it's missing). `npm`: how to run
// it (tests hand in their own).
// (npm.cmd only runs through the shell on Windows; its arguments here are fixed)
async function install(dir, { npm = (args) => run(WIN ? 'npm.cmd' : 'npm', args, { cwd: dir, timeout: 15 * 60000, shell: WIN }) } = {}) {
  await npm(['ci', '--no-audit', '--no-fund', '--loglevel=error']);
  if (!electronThere(dir)) await run(process.execPath, [path.join(dir, 'node_modules', 'electron', 'install.js')], { cwd: dir, timeout: 10 * 60000 });
  if (!electronThere(dir)) throw new Error('Electron missing');
}

// Her packages after `apply`, and if that fails: back to `from`, with its packages. { ok, error }
async function finish(dir, from, opts = {}) {
  try {
    await install(dir, opts);
    return { ok: true };
  } catch (err) {
    await git(dir, ['reset', '--keep', from]).catch(() => {});
    await install(dir, opts).catch(() => {});
    return { ok: false, error: err.output || err.message };
  }
}

// For when her packages changed: a helper, run by the Node.js on this PC (her own Electron is what npm
// replaces), that waits for her to close, runs `finish`, and starts her again with the same arguments.
function handOff(dir, from, relaunch) {
  const child = spawn(WIN ? 'node.exe' : 'node', [path.join(dir, 'scripts', 'update-finish.js'), dir, from, String(process.pid), JSON.stringify(relaunch)], {
    cwd: dir, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
}

// back to the commit she was on (when what comes after `apply` can't go on)
const rollback = (dir, from) => git(dir, ['reset', '--keep', from]);

module.exports = { check, blocked, apply, install, finish, handOff, rollback };
