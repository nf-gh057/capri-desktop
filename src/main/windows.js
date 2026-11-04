'use strict';

// Feeds the overlay with the position of the other windows (Windows only), so Capri can
// sit on them. A small PowerShell helper does the Win32 calls; we turn its physical pixels
// into the overlay's coordinates. It also says when the window in front is another AI (ChatGPT,
// Gemini…: `ai`, the names it matched; `pages`, the ones whose own page it is in a browser; `dl`,
// a page to download one of them), for her jealousy; which game is in front, if one (`game`, its
// folder in Steam's library or another launcher's); and the USB sticks plugged in (`usb`, drive
// letters), and the last device plugged in or out (`plug`). The title of the window in front comes
// only once titles(true) asked for it (`title`, `browser`), for the model on this PC to say whether
// it's another AI (spot.js); main.js keeps it from the overlay. close() and shut() have it close one
// of those pages, jealous.

const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { screen } = require('electron');

// in the installed app it sits next to the app archive (asarUnpack), where PowerShell can read it
const SCRIPT = path.join(__dirname, 'windows.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startWindowWatch({ overlay, onUpdate }) {
  if (process.platform !== 'win32') return { stop() {}, refresh() {}, titles() {}, close: async () => 'windows', shut: async () => 'windows' };

  let child = null;
  let stopped = false;
  let restarts = 0;
  let last = null; // the helper's last snapshot: it only speaks when something changes
  let asks = 0;
  let titles = false; // the title of the window in front asked for (her jealousy with a local model)
  const asked = new Map(); // what we asked the helper, waiting for its answer: number -> resolve

  const handle = overlay.getNativeWindowHandle();
  const self = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));

  const toOverlay = (win, bounds) => {
    const dip = screen.screenToDipRect(null, { x: win.x, y: win.y, width: win.w, height: win.h });
    return { id: win.id, x: dip.x - bounds.x, y: dip.y - bounds.y, w: dip.width, h: dip.height, max: win.max };
  };

  // the snapshot as seen from her window, wherever it is now
  const send = () => {
    if (!last || overlay.isDestroyed()) return;
    const bounds = overlay.getBounds();
    const wins = last.wins
      .map((w) => toOverlay(w, bounds))
      // only what overlaps Capri's screen
      .filter((w) => w.x < bounds.width && w.x + w.w > 0 && w.y < bounds.height && w.y + w.h > 0);
    onUpdate({
      fg: last.fg, taskbar: Boolean(last.taskbar), ai: Array.isArray(last.ai) ? last.ai : [],
      pages: Array.isArray(last.pages) ? last.pages : [], dl: Boolean(last.dl),
      game: last.game || null, usb: Array.isArray(last.usb) ? last.usb : [], plug: last.plug || null, wins,
      ...(titles && typeof last.title === 'string' && { title: last.title, browser: Boolean(last.browser) }),
    });
  };

  const answer = (n, why) => {
    asked.get(n)?.(why);
    asked.delete(n);
  };

  const start = () => {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, String(self), String(process.pid),
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if ('closed' in msg) return answer(msg.closed, String(msg.why ?? 'error'));
      last = msg;
      send();
    });
    child.stdin.on('error', () => {}); // it went away: its exit says so
    if (titles) child.stdin.write('titles 1\n');
    child.stderr.on('data', (d) => console.error('[capri] window watch:', String(d).trim()));
    child.on('exit', () => {
      child = null;
      for (const n of [...asked.keys()]) answer(n, 'gone');
      if (!stopped && restarts++ < 3) setTimeout(start, 3000);
    });
  };

  // One question for the helper: its answer as it comes (or 'late', 'gone')
  const ask = (line) => {
    if (!child) return Promise.resolve('gone');
    const n = ++asks;
    return new Promise((resolve) => {
      asked.set(n, resolve);
      child.stdin.write(`${line(n)}\n`);
      setTimeout(() => answer(n, 'late'), 3000);
    });
  };

  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
    // her window moved (another screen, the taskbar in it or not): the same windows, from there
    refresh: send,
    // Close the page of AI `key` (a tab, Ctrl+W) in window `id`, if it's still that page and in
    // front: '' once done, else why not ('front', 'browser', 'page', 'keys', 'gone', 'late').
    close(id, key) {
      return ask((n) => `close ${Math.trunc(Number(id)) || 0} ${String(key).replace(/\W/g, '')} ${n}`);
    },
    // The same for a page the model on this PC took for another AI's: if window `id` still has that
    // very title (as it came in a snapshot).
    shut(id, title) {
      return ask((n) => `shut ${Math.trunc(Number(id)) || 0} ${n} ${Buffer.from(String(title), 'utf8').toString('base64')}`);
    },
    // The title of the window in front, from now on, or no more.
    titles(on) {
      if (titles === Boolean(on)) return;
      titles = Boolean(on);
      child?.stdin.write(`titles ${titles ? 1 : 0}\n`);
    },
  };
}

module.exports = { startWindowWatch };
