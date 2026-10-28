#!/usr/bin/env node
'use strict';

// This fork's version: mochiiwuff's version, then which of our commits on top of it this is.
// 0.4.4-1, 0.4.4-2…, back to -1 once upstream's own version goes up (0.4.5-1).
//
//   node scripts/version.js          before each of our commits: the next number
//   node scripts/version.js 0.4.5    upstream's version is now 0.4.5 (if git can't tell)
//
// Upstream's version is read from upstream/main's package.json when that remote is there. The new
// version goes in package.json and package-lock.json, and is printed.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

// a before b, as versions go
const older = (a, b) => {
  const x = SEMVER.exec(a).slice(1).map(Number);
  const y = SEMVER.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

function upstreamVersion() {
  try {
    const pkg = execFileSync('git', ['show', 'upstream/main:package.json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const { version } = JSON.parse(pkg);
    return SEMVER.test(version) ? version : null;
  } catch {
    return null; // no upstream remote here
  }
}

function next(current, upstream) {
  const [, base, n] = /^(\d+\.\d+\.\d+)(?:-(\d+))?$/.exec(current) || [];
  if (!base) throw new Error(`can't read the version "${current}"`);
  if (upstream && older(base, upstream)) return `${upstream}-1`;
  return `${base}-${n ? Number(n) + 1 : 1}`;
}

function write(file, change) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return;
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  change(json);
  fs.writeFileSync(full, `${JSON.stringify(json, null, 2)}\n`);
}

const given = process.argv[2];
if (given && !SEMVER.test(given)) {
  console.error('usage: node scripts/version.js [upstream version, e.g. 0.4.5]');
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = next(pkg.version, given || upstreamVersion());
write('package.json', (json) => { json.version = version; });
write('package-lock.json', (json) => {
  json.version = version;
  if (json.packages?.['']) json.packages[''].version = version;
});
console.log(version);
