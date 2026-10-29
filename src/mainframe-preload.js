'use strict';

// Her settings window's only way out (main/mainframe.js): read what it shows, ask for a change.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mainframe', {
  state: () => ipcRenderer.invoke('mainframe:state'),
  act: (name, value) => ipcRenderer.invoke('mainframe:act', { name, value }),
  onState: (fn) => {
    const listener = (_e, state) => fn(state);
    ipcRenderer.on('mainframe:state', listener);
    return () => ipcRenderer.removeListener('mainframe:state', listener);
  },
  onStream: (fn) => {
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on('mainframe:stream', listener);
    return () => ipcRenderer.removeListener('mainframe:stream', listener);
  },
  minimize: () => ipcRenderer.send('mainframe:window', 'minimize'),
  close: () => ipcRenderer.send('mainframe:window', 'close'),
});
