'use strict';

// Main process: one sandboxed window, plus SmartSpectra sensing (see sensing.js).

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');
const { bindSensing } = require('./sensing');

const DEMO = process.argv.includes('--demo');

// The API key stays in the main process and never reaches the page.
function readApiKey() {
    if (process.env.SMARTSPECTRA_API_KEY) return process.env.SMARTSPECTRA_API_KEY;
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return '';
    const m = fs.readFileSync(file, 'utf8').match(/^\s*SMARTSPECTRA_API_KEY\s*=\s*["']?([^"'\s]+)/m);
    return m ? m[1] : '';
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1180,
        height: 800,
        minWidth: 900,
        minHeight: 640,
        backgroundColor: '#f6f4ef',
        title: 'Breathe Before Send',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });

    bindSensing(win, readApiKey());

    // The app only ever shows its own bundled page.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());

    win.removeMenu();
    win.loadFile(path.join(__dirname, 'index.html'), { query: { demo: DEMO ? '1' : '0' } });
    if (process.env.BBS_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(() => {
    // The page itself never needs camera, mic or any other permission: the
    // SDK captures natively in this process.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
