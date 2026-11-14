'use strict';

// Runs SmartSpectra in the main process with the SDK's native camera capture.
// Native capture locks the webcam at 30 fps; capturing through Chromium let the
// frame rate drop below the SDK's 25 fps minimum in dim rooms.
//
// The renderer gets metrics buffers, validation hints and a small JPEG preview
// over IPC. Nothing is written to disk.

const { ipcMain, nativeImage } = require('electron');

const PREVIEW_EVERY_MS = 125; // about 8 preview frames per second
const PREVIEW_WIDTH = 480;

// On slow connections the SDK's calls to Presage can time out. Retry with a
// growing delay before giving up.
const RETRY_DELAYS_MS = [2000, 5000, 10000];

function loadSdk() {
    try {
        return require('@smartspectra/node-sdk');
    } catch (err) {
        console.error('[breathe-before-send] SmartSpectra SDK failed to load:', err.message);
        return null;
    }
}

// Electron's createFromBitmap expects BGRA.
function toBGRA(buf, width, height, stride, pixelFormat, PixelFormat) {
    const out = Buffer.alloc(width * height * 4);
    const bpp = pixelFormat === PixelFormat.kRGB || pixelFormat === PixelFormat.kBGR ? 3 : 4;
    const swap = pixelFormat === PixelFormat.kRGB || pixelFormat === PixelFormat.kRGBA;
    for (let y = 0; y < height; y++) {
        let src = y * stride;
        let dst = y * width * 4;
        for (let x = 0; x < width; x++, src += bpp, dst += 4) {
            out[dst] = swap ? buf[src + 2] : buf[src];
            out[dst + 1] = buf[src + 1];
            out[dst + 2] = swap ? buf[src] : buf[src + 2];
            out[dst + 3] = 255;
        }
    }
    return out;
}

function bindSensing(win, apiKey) {
    const mod = loadSdk();
    let sdk = null;
    let options = null;
    let attempt = 0;
    let retryTimer = null;
    let lastPreview = 0;

    const send = (channel, ...args) => {
        if (!win.isDestroyed()) win.webContents.send(channel, ...args);
    };
    const names = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k.replace(/^k/, '')]));

    async function teardown() {
        clearTimeout(retryTimer);
        retryTimer = null;
        if (!sdk) return;
        const s = sdk;
        sdk = null;
        try { await s.stopAsync(); } catch { /* already stopped */ }
        try { await s.destroy(); } catch { /* already destroyed */ }
    }

    function requestedMetrics() {
        const m = mod.MetricType;
        const list = [m.CHEST_BREATHING, m.BREATHING_RATE, m.PULSE_RATE, m.HRV];
        if (options.expressions) list.push(m.EXPRESSIONS);
        return list;
    }

    function launch() {
        const s = new mod.SmartSpectraSDK({
            apiKey,
            enableTelemetry: !!options.telemetry,
            requestedMetrics: requestedMetrics(),
        });
        const validationNames = names(mod.ValidationCode);
        s.on('validationStatus', (code, _ts, hint) =>
            send('bbs:validation', code === mod.ValidationCode.kOk, validationNames[code] || String(code), hint));
        s.on('metrics', (buf) => {
            attempt = 0; // a working session resets the retry budget
            send('bbs:metrics', new Uint8Array(buf));
        });
        s.on('videoOutput', (buf, width, height, stride, pixelFormat) => {
            const now = Date.now();
            if (now - lastPreview < PREVIEW_EVERY_MS) return;
            lastPreview = now;
            try {
                const img = nativeImage
                    .createFromBitmap(toBGRA(buf, width, height, stride, pixelFormat, mod.PixelFormat), { width, height })
                    .resize({ width: PREVIEW_WIDTH });
                send('bbs:preview', img.toDataURL());
            } catch { /* skip a preview frame */ }
        });
        s.on('error', (code, message, retryable) => onError(s, code, message, retryable));

        const cams = mod.SmartSpectraSDK.availableCameras();
        if (cams.length === 0) throw new Error('No camera found.');
        s.useCamera(mod.CameraSelection.byId(cams[0].id), { width: 1280, height: 720, fps: 30 });
        sdk = s;
        s.start();
    }

    async function onError(s, code, message, retryable) {
        if (s !== sdk) return; // a session we already replaced
        await teardown();
        const network = code === mod.SmartSpectraErrorCode.kNetworkError || code === mod.SmartSpectraErrorCode.kServerError;
        if (retryable && attempt < RETRY_DELAYS_MS.length) {
            const delay = RETRY_DELAYS_MS[attempt++];
            const why = network ? 'The connection to Presage is slow.' : 'Sensing hit a problem.';
            send('bbs:validation', false, 'Retrying', `${why} Retrying in ${delay / 1000} s (${attempt}/${RETRY_DELAYS_MS.length})…`);
            retryTimer = setTimeout(() => {
                try { launch(); } catch (err) { send('bbs:fatal', err.message); }
            }, delay);
            return;
        }
        const hint = network ? ' Check your internet connection and try again.' : '';
        send('bbs:fatal', `Sensing stopped (SmartSpectra error ${code}: ${message}).${hint} The camera is off.`);
    }

    ipcMain.handle('bbs:available', () => ({ sdk: !!mod, apiKey: !!apiKey }));

    ipcMain.handle('bbs:start', async (_e, opts) => {
        if (!mod) throw new Error('The SmartSpectra SDK could not load on this computer. Try the simulated signals instead.');
        if (!apiKey) throw new Error('No API key found. Add SMARTSPECTRA_API_KEY to .env and run npm start again.');
        await teardown();
        options = { telemetry: !!(opts && opts.telemetry), expressions: !!(opts && opts.expressions) };
        attempt = 0;
        launch();
    });

    ipcMain.handle('bbs:stop', () => teardown());

    win.on('closed', () => { teardown(); });
}

module.exports = { bindSensing };
