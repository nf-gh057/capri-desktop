'use strict';

// Bits of the screen, fast (Windows only), for her teleports to tear open where she leaves and
// where she lands (fx.js tear). desktopCapturer takes half a second a picture, longer than her
// whole teleport; a small PowerShell helper (screengrab.ps1) copies just those bits in a few ms.
// Started once, it waits for rects on its stdin. Nothing is kept: each picture goes straight to her
// window to be drawn for a moment.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'screengrab.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startScreenGrab() {
  if (process.platform !== 'win32') return { grab: async (rects) => rects.map(() => null), stop() {} };

  let child = null;
  const waiting = []; // a callback for each request sent, answered in order

  const start = () => {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let list = null;
      try {
        list = JSON.parse(line);
      } catch {
        // not an answer: the next one will be
      }
      waiting.shift()?.(Array.isArray(list) ? list : null);
    });
    child.stderr.on('data', (d) => console.error('[capri] screen grab:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      for (const done of waiting.splice(0)) done(null);
    });
  };

  start(); // it takes PowerShell a moment to start: ready before her first teleport
  return {
    // rects in physical screen px: a JPEG (Buffer) for each, or null
    grab(rects) {
      if (!child) start();
      return new Promise((resolve) => {
        waiting.push((list) => resolve(rects.map((_, i) => (list?.[i] ? Buffer.from(list[i], 'base64') : null))));
        child.stdin.write(`${rects.map((r) => [r.x, r.y, r.width, r.height].map(Math.round).join(',')).join(';')}\n`);
      });
    },
    stop() {
      child?.kill();
    },
  };
}

module.exports = { startScreenGrab };
