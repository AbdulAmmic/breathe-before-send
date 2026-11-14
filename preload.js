'use strict';

// Exposes a narrow sensing API to the page. The page never gets Node or raw IPC.

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['bbs:validation', 'bbs:metrics', 'bbs:preview', 'bbs:fatal'];

contextBridge.exposeInMainWorld('bbs', {
    available: () => ipcRenderer.invoke('bbs:available'),
    start: (opts) => ipcRenderer.invoke('bbs:start', opts),
    stop: () => ipcRenderer.invoke('bbs:stop'),
    on: (channel, cb) => {
        if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`);
        ipcRenderer.on(channel, (_e, ...args) => cb(...args));
    },
});
