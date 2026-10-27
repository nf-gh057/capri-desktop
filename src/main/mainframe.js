'use strict';

// Her settings window, "Mainframe": what her tray menu holds, laid out on one page. main.js says what
// the page shows (state) and does what it asks (act); only this window may ask.

const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');

const WIDTH = 400;
const HEIGHT = 760;

function createMainframe({ root, display, state, act }) {
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
    // in the middle of the screen she's on, and never taller than it
    const { workArea: a } = display();
    const height = Math.min(HEIGHT, a.height - 40);
    win = new BrowserWindow({
      x: Math.round(a.x + (a.width - WIDTH) / 2),
      y: Math.round(a.y + (a.height - height) / 2),
      width: WIDTH,
      height,
      minWidth: WIDTH,
      minHeight: 360,
      maxWidth: WIDTH,
      frame: false,
      resizable: true, // in height only
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#110d1a',
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
    win.once('ready-to-show', () => win?.show());
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
