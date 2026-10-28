'use strict';

// The end of her update when her packages changed (src/main/update.js handOff): run by the Node.js on
// this PC once she's closed, as npm replaces her own Electron. Her packages installed again (back to
// where she was, if that fails), then she starts again as she was started. What happened goes to
// update.log in her folder.
//
//   node scripts/update-finish.js <her folder> <commit she was on> <her pid> <[program, ...arguments]>

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { finish } = require('../src/main/update');

const [dir, from, pid, relaunch] = process.argv.slice(2);
const log = (line) => fs.appendFileSync(path.join(dir, 'update.log'), `${new Date().toISOString()} ${line}\n`);

const alive = (id) => {
  try {
    process.kill(Number(id), 0);
    return true;
  } catch {
    return false;
  }
};

(async () => {
  for (let i = 0; alive(pid) && i < 120; i++) await new Promise((r) => setTimeout(r, 500)); // a minute at most
  log(`installing her packages (from ${from.slice(0, 8)})`);
  const done = await finish(dir, from);
  log(done.ok ? 'done' : `failed, back to ${from.slice(0, 8)}: ${done.error}`);
  const [program, ...args] = JSON.parse(relaunch);
  spawn(program, args, { cwd: dir, detached: true, stdio: 'ignore', env: { ...process.env, CAPRI_UPDATE_FAILED: done.ok ? '' : '1' } }).unref();
})().catch((err) => log(`error: ${err.message}`));
