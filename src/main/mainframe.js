'use strict';

// Her settings window, "Mainframe": what her tray menu holds, on tabs, in a window like her game's
// menus (sized, maximized, snapped as any other). main.js says what the page shows (state) and does
// what it asks (act); only this window may ask.

const path = require('node:path');
const { BrowserWindow, ipcMain, screen } = require('electron');

const WIDTH = 1080;
const HEIGHT = 720;
const BG = '#0b0a0f';

function createMainframe({ root, display, state, act, bounds }) {
  let win = null;
  const own = (event) => Boolean(win) && !win.isDestroyed() && event.sender === win.webContents;

  ipcMain.handle('mainframe:state', (event) => (own(event) ? state() : null));
  ipcMain.handle('mainframe:act', async (event, request) => {
    if (!own(event) || typeof request?.name !== 'string') return null;
    await act(request.name, request.value);
    return state();
  });
  ipcMain.on('mainframe:window', (event, what) => {
    if (!own(event)) return;
    if (what === 'minimize') win.minimize();
    else if (what === 'close') win.close();
  });

  function open() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return win;
    }
    // where you left it, if that's still on one of your screens; else in the middle of the one she's
    // on, and never bigger than it
    const saved = bounds.get();
    const seen = saved && screen.getAllDisplays().some(({ workArea: w }) =>
      saved.x < w.x + w.width - 80 && saved.x + saved.width > w.x + 80 && saved.y >= w.y - 10 && saved.y < w.y + w.height - 80);
    const { workArea: a } = display();
    const width = Math.min(WIDTH, a.width - 40);
    const height = Math.min(HEIGHT, a.height - 40);
    const place = seen
      ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
      : { x: Math.round(a.x + (a.width - width) / 2), y: Math.round(a.y + (a.height - height) / 2), width, height };
    win = new BrowserWindow({
      ...place,
      minWidth: 640,
      minHeight: 420,
      // Windows' own buttons (snap layouts too) over her own title bar
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: BG, symbolColor: '#ff5f56', height: 38 },
      fullscreenable: false,
      backgroundColor: BG,
      title: 'Capri — Mainframe',
      icon: path.join(root, 'assets', 'icons', 'capri.png'),
      show: false,
      webPreferences: {
        preload: path.join(root, 'src', 'mainframe-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.setMenu(null);
    // links and new windows stay out: this page only talks to main.js
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.loadURL('capri://app/src/renderer/mainframe.html');
    win.once('ready-to-show', () => {
      if (seen && saved.maximized) win?.maximize();
      win?.show();
    });
    win.on('close', () => bounds.set({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    win.on('closed', () => { win = null; });
    return win;
  }

  // what it shows, again: after anything changed (her menu, her chat, this window)
  function refresh() {
    if (win && !win.isDestroyed()) win.webContents.send('mainframe:state', state());
  }

  return { open, refresh, window: () => win };
}

module.exports = { createMainframe };
